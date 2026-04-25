// ============================================================
// LIFEGRID – Kafka Client Wrapper
// Typed producer/consumer with retry, DLQ, and schema registry
// ============================================================

import { Kafka, Producer, Consumer, Admin, EachMessagePayload,
         CompressionTypes, logLevel } from 'kafkajs';
import { TOPICS, TOPIC_CONFIG, TopicName } from './topics';

const BROKERS = (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(',');
const CLIENT_ID = process.env.KAFKA_CLIENT_ID ?? 'lifegrid-service';
const DLQ_SUFFIX = '.dlq';

// ── Envelope schema ───────────────────────────────────────────

export interface KafkaEnvelope<T = unknown> {
  eventId:     string;
  eventType:   string;
  topic:       TopicName;
  version:     string;
  timestamp:   string;
  sourceService: string;
  correlationId?: string;
  payload:     T;
  metadata?: {
    incidentId?: string;
    userId?: string;
    retryCount?: number;
    originalTopic?: string;
  };
}

// ── Client ────────────────────────────────────────────────────

export class KafkaClient {
  private static kafka: Kafka;
  private static producer: Producer | null = null;
  private static consumers: Map<string, Consumer> = new Map();
  private static admin: Admin | null = null;

  static initialize(): void {
    this.kafka = new Kafka({
      clientId: CLIENT_ID,
      brokers: BROKERS,
      logLevel: logLevel.WARN,
      retry: {
        initialRetryTime: 100,
        retries: 8,
        maxRetryTime: 30000,
        factor: 2,
      },
      ssl: process.env.KAFKA_SSL === 'true' ? {
        rejectUnauthorized: true,
        ca: process.env.KAFKA_CA_CERT,
        cert: process.env.KAFKA_CLIENT_CERT,
        key: process.env.KAFKA_CLIENT_KEY,
      } : undefined,
      sasl: process.env.KAFKA_SASL_USERNAME ? {
        mechanism: 'scram-sha-512',
        username: process.env.KAFKA_SASL_USERNAME,
        password: process.env.KAFKA_SASL_PASSWORD ?? '',
      } : undefined,
    });
  }

  // ── Admin: topic provisioning ─────────────────────────────

  static async provisionTopics(): Promise<void> {
    const admin = this.kafka.admin();
    await admin.connect();

    const existing = new Set(await admin.listTopics());
    const toCreate = Object.entries(TOPIC_CONFIG)
      .filter(([topic]) => !existing.has(topic))
      .map(([topic, config]) => ({
        topic,
        numPartitions: config.partitions,
        replicationFactor: config.replicationFactor,
        configEntries: [
          { name: 'retention.ms', value: String(config.retentionMs) },
          { name: 'cleanup.policy', value: config.cleanupPolicy },
          { name: 'compression.type', value: 'lz4' },
        ],
      }));

    // Also create DLQ topics
    const dlqTopics = toCreate.map(t => ({
      topic: `${t.topic}${DLQ_SUFFIX}`,
      numPartitions: 1,
      replicationFactor: t.replicationFactor,
      configEntries: [
        { name: 'retention.ms', value: String(30 * 86400000) },
        { name: 'cleanup.policy', value: 'delete' },
      ],
    }));

    if (toCreate.length > 0) {
      await admin.createTopics({ topics: [...toCreate, ...dlqTopics], waitForLeaders: true });
    }

    await admin.disconnect();
  }

  // ── Producer ──────────────────────────────────────────────

  static async getProducer(): Promise<Producer> {
    if (!this.producer) {
      this.producer = this.kafka.producer({
        idempotent: true,
        maxInFlightRequests: 5,
        transactionTimeout: 30000,
      });
      await this.producer.connect();
    }
    return this.producer;
  }

  static async publish<T>(
    topic: TopicName,
    payload: T,
    options: {
      key?: string;
      correlationId?: string;
      metadata?: KafkaEnvelope['metadata'];
      sourceService?: string;
    } = {},
  ): Promise<void> {
    const producer = await this.getProducer();
    const envelope: KafkaEnvelope<T> = {
      eventId:       crypto.randomUUID(),
      eventType:     topic.split('.').slice(-1)[0].toUpperCase(),
      topic,
      version:       '1.0',
      timestamp:     new Date().toISOString(),
      sourceService: options.sourceService ?? CLIENT_ID,
      correlationId: options.correlationId,
      payload,
      metadata:      options.metadata,
    };

    await producer.send({
      topic,
      compression: CompressionTypes.LZ4,
      messages: [{
        key: options.key ?? envelope.eventId,
        value: JSON.stringify(envelope),
        headers: {
          'content-type': 'application/json',
          'event-id':     envelope.eventId,
          'event-type':   envelope.eventType,
          'source':       envelope.sourceService,
          'timestamp':    envelope.timestamp,
        },
      }],
    });
  }

  static async publishBatch<T>(
    topic: TopicName,
    messages: Array<{ payload: T; key?: string }>,
    sourceService?: string,
  ): Promise<void> {
    const producer = await this.getProducer();
    await producer.send({
      topic,
      compression: CompressionTypes.LZ4,
      messages: messages.map(({ payload, key }) => {
        const envelope: KafkaEnvelope<T> = {
          eventId:       crypto.randomUUID(),
          eventType:     topic.split('.').slice(-1)[0].toUpperCase(),
          topic,
          version:       '1.0',
          timestamp:     new Date().toISOString(),
          sourceService: sourceService ?? CLIENT_ID,
          payload,
        };
        return {
          key: key ?? envelope.eventId,
          value: JSON.stringify(envelope),
        };
      }),
    });
  }

  // ── Consumer ──────────────────────────────────────────────

  static async subscribe<T>(
    groupId: string,
    topics: TopicName[],
    handler: (envelope: KafkaEnvelope<T>, raw: EachMessagePayload) => Promise<void>,
    options: {
      fromBeginning?: boolean;
      maxRetries?: number;
      sendToDLQ?: boolean;
    } = {},
  ): Promise<Consumer> {
    const consumer = this.kafka.consumer({
      groupId,
      sessionTimeout: 30000,
      heartbeatInterval: 3000,
      maxBytesPerPartition: 1048576,  // 1MB
    });

    await consumer.connect();
    await consumer.subscribe({ topics, fromBeginning: options.fromBeginning ?? false });

    await consumer.run({
      eachMessage: async (raw) => {
        const { topic, partition, message } = raw;
        if (!message.value) return;

        let envelope: KafkaEnvelope<T>;
        try {
          envelope = JSON.parse(message.value.toString());
        } catch {
          console.error(`[Kafka] Failed to parse message on ${topic}:${partition}`);
          return;
        }

        const maxRetries = options.maxRetries ?? 3;
        let attempt = 0;

        while (attempt <= maxRetries) {
          try {
            await handler(envelope, raw);
            return;
          } catch (err) {
            attempt++;
            if (attempt > maxRetries) {
              if (options.sendToDLQ !== false) {
                await this.sendToDLQ(topic as TopicName, envelope, err as Error);
              }
              console.error(`[Kafka] Handler failed after ${maxRetries} retries on ${topic}:`, err);
              return;
            }
            await new Promise(r => setTimeout(r, 100 * Math.pow(2, attempt)));
          }
        }
      },
    });

    this.consumers.set(groupId, consumer);
    return consumer;
  }

  // ── Dead Letter Queue ─────────────────────────────────────

  private static async sendToDLQ(
    originalTopic: TopicName,
    envelope: KafkaEnvelope,
    error: Error,
  ): Promise<void> {
    try {
      const producer = await this.getProducer();
      await producer.send({
        topic: `${originalTopic}${DLQ_SUFFIX}`,
        messages: [{
          key: envelope.eventId,
          value: JSON.stringify({
            ...envelope,
            metadata: {
              ...envelope.metadata,
              originalTopic,
              dlqReason: error.message,
              dlqTimestamp: new Date().toISOString(),
            },
          }),
        }],
      });
    } catch {
      // DLQ failure is non-fatal
    }
  }

  // ── Graceful shutdown ─────────────────────────────────────

  static async disconnect(): Promise<void> {
    if (this.producer) await this.producer.disconnect();
    for (const consumer of this.consumers.values()) {
      await consumer.disconnect();
    }
    if (this.admin) await this.admin.disconnect();
  }
}
