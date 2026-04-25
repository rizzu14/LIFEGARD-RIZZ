"""
============================================================
LIFEGRID AI Engine – NLP Emergency Classifier
============================================================
Architecture:
  Primary:  DistilBERT fine-tuned on emergency call transcripts
            → 12-class incident classification
            → Named entity recognition (spaCy)
            → Sentiment / urgency scoring
  Fallback: TF-IDF + Logistic Regression (no GPU required)

Input:  Raw text (any language), detected language code
Output: NLPAnalysis schema (matches shared-types)

Latency target: < 150ms (GPU), < 400ms (CPU)
============================================================
"""
import re
import time
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Tuple

import numpy as np
import structlog

log = structlog.get_logger()

# ── Incident taxonomy ─────────────────────────────────────────

INCIDENT_LABELS = [
    "MEDICAL", "FIRE", "NATURAL_DISASTER", "SECURITY",
    "INFRASTRUCTURE", "CHEMICAL", "BIOLOGICAL", "RADIOLOGICAL",
    "NUCLEAR", "CYBER", "MASS_CASUALTY", "UNKNOWN",
]

# Fine-grained medical sub-types for triage
MEDICAL_SUBTYPES = {
    "cardiac_arrest": ["heart attack", "cardiac arrest", "no pulse", "not breathing", "chest pain", "myocardial"],
    "stroke":         ["stroke", "face drooping", "arm weakness", "slurred speech", "sudden numbness"],
    "trauma":         ["bleeding", "stabbed", "shot", "hit by car", "fell", "fracture", "broken bone"],
    "respiratory":    ["can't breathe", "choking", "asthma", "difficulty breathing", "shortness of breath"],
    "overdose":       ["overdose", "unconscious", "drugs", "pills", "poisoning", "ingested"],
    "burn":           ["burned", "scalded", "fire injury", "chemical burn"],
    "obstetric":      ["labor", "giving birth", "pregnant", "contractions", "water broke"],
    "pediatric":      ["child", "baby", "infant", "toddler", "newborn"],
    "psychiatric":    ["suicide", "self-harm", "mental health crisis", "threatening self"],
}

# Keyword corpus per class (used by TF-IDF fallback + confidence boosting)
KEYWORD_CORPUS: Dict[str, List[str]] = {
    "MEDICAL": [
        "heart attack", "cardiac arrest", "stroke", "unconscious", "not breathing",
        "bleeding", "injured", "ambulance", "hospital", "pain", "overdose", "seizure",
        "choking", "allergic reaction", "diabetic", "chest pain", "pulse", "cpr",
        "trauma", "fracture", "burn", "poisoning", "labor", "baby", "child",
    ],
    "FIRE": [
        "fire", "smoke", "burning", "flames", "explosion", "blaze", "arson",
        "gas leak", "electrical fire", "wildfire", "structure fire", "trapped",
        "evacuate", "extinguisher", "sprinkler", "carbon monoxide",
    ],
    "NATURAL_DISASTER": [
        "earthquake", "flood", "tsunami", "tornado", "hurricane", "cyclone",
        "landslide", "mudslide", "avalanche", "storm surge", "flash flood",
        "volcanic", "eruption", "drought", "wildfire", "blizzard",
    ],
    "SECURITY": [
        "shooting", "gunshot", "robbery", "attack", "weapon", "bomb", "hostage",
        "violence", "assault", "stabbing", "threat", "suspicious", "intruder",
        "active shooter", "terrorism", "kidnapping", "carjacking",
    ],
    "INFRASTRUCTURE": [
        "power outage", "gas leak", "bridge collapse", "road collapse", "water main",
        "dam failure", "pipeline", "blackout", "transformer", "sinkhole",
        "building collapse", "structural failure",
    ],
    "CHEMICAL": [
        "chemical", "toxic", "spill", "hazmat", "fumes", "poison", "chlorine",
        "ammonia", "acid", "industrial accident", "chemical plant", "exposure",
    ],
    "BIOLOGICAL": [
        "biological", "outbreak", "epidemic", "contamination", "virus", "bacteria",
        "anthrax", "plague", "ebola", "pandemic", "infection", "quarantine",
    ],
    "RADIOLOGICAL": [
        "radiation", "radioactive", "nuclear material", "dirty bomb", "geiger",
        "contamination", "fallout", "isotope",
    ],
    "NUCLEAR": [
        "nuclear", "reactor", "meltdown", "nuclear plant", "core breach",
        "nuclear explosion", "mushroom cloud",
    ],
    "CYBER": [
        "cyber attack", "hack", "system down", "ransomware", "breach", "ddos",
        "critical infrastructure", "power grid attack", "data breach",
    ],
    "MASS_CASUALTY": [
        "mass casualty", "multiple victims", "mass shooting", "mass disaster",
        "hundreds injured", "many dead", "catastrophe", "mass fatality",
    ],
    "UNKNOWN": [],
}

# Urgency / sentiment signals
PANIC_SIGNALS = [
    "help", "please", "dying", "hurry", "now", "fast", "emergency",
    "critical", "urgent", "immediately", "quickly", "save", "bleeding out",
]
CALM_SIGNALS = ["reporting", "noticed", "observed", "seems", "appears", "possible"]

# Entity extraction patterns
ENTITY_PATTERNS = {
    "LOCATION": [
        r"(?:at|near|on|in|by|corner of|intersection of)\s+([A-Z][a-zA-Z0-9\s,\.]+?)(?:\.|,|$|\band\b)",
        r"(\d+\s+[A-Z][a-zA-Z\s]+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Drive|Dr|Lane|Ln|Way|Court|Ct))",
        r"(?:building|floor|room|apartment|unit)\s+([A-Z0-9][a-zA-Z0-9\s\-]+)",
    ],
    "PERSON": [
        r"(?:man|woman|person|individual|victim|child|male|female)\s+(?:in\s+)?([a-z]+\s+(?:shirt|jacket|dress|clothes))",
        r"(?:approximately|about|around)\s+(\d+)\s+(?:years?\s+old|y\.?o\.?)",
    ],
    "INJURY": [
        r"(bleeding|unconscious|not breathing|no pulse|severe pain|broken|fractured|burned|stabbed|shot)",
    ],
    "HAZARD": [
        r"(fire|smoke|gas leak|chemical spill|flood water|downed power line|structural damage)",
    ],
    "VEHICLE": [
        r"([A-Z]{1,3}\s*\d{3,4}\s*[A-Z]{0,3})",  # license plate
        r"(ambulance|fire truck|police car|helicopter|bus|truck|van|motorcycle)",
    ],
    "WEAPON": [
        r"(gun|knife|rifle|pistol|shotgun|explosive|bomb|grenade|machete)",
    ],
    "TIME": [
        r"(\d{1,2}:\d{2}\s*(?:am|pm|AM|PM)?)",
        r"(just now|minutes ago|hours ago|yesterday|this morning|tonight)",
    ],
}


@dataclass
class NLPResult:
    original_text: str
    translated_text: Optional[str]
    detected_language: str
    confidence: float
    entities: List[Dict]
    intent: str
    sentiment: str
    keywords: List[str]
    classified_type: str
    classification_confidence: float
    medical_subtype: Optional[str]
    urgency_score: float          # 0.0–1.0
    processing_ms: float


class NLPClassifier:
    """
    Two-tier NLP classifier:
      Tier 1: Transformer model (DistilBERT) — high accuracy, ~120ms GPU
      Tier 2: TF-IDF + Logistic Regression — fast fallback, ~5ms CPU
    """

    def __init__(self):
        self._transformer_ready = False
        self._tfidf_ready = False
        self._transformer = None
        self._tokenizer = None
        self._tfidf_vectorizer = None
        self._tfidf_classifier = None
        self._nlp_spacy = None

        self._init_tfidf()       # Always available
        self._init_transformer() # Best-effort
        self._init_spacy()       # Best-effort

    # ── Initialization ────────────────────────────────────────

    def _init_tfidf(self) -> None:
        """
        Build TF-IDF classifier from keyword corpus.
        This is the guaranteed fallback — no external dependencies.
        """
        from sklearn.feature_extraction.text import TfidfVectorizer
        from sklearn.linear_model import LogisticRegression
        from sklearn.pipeline import Pipeline

        # Build synthetic training corpus from keywords
        X_train, y_train = [], []
        for label, keywords in KEYWORD_CORPUS.items():
            if not keywords:
                continue
            # Each keyword phrase becomes a training sample
            for kw in keywords:
                X_train.append(kw)
                y_train.append(label)
            # Combine pairs for richer context
            for i in range(0, len(keywords) - 1, 2):
                X_train.append(f"{keywords[i]} {keywords[i+1]}")
                y_train.append(label)

        self._tfidf_pipeline = Pipeline([
            ("tfidf", TfidfVectorizer(
                ngram_range=(1, 3),
                max_features=8000,
                sublinear_tf=True,
                analyzer="word",
            )),
            ("clf", LogisticRegression(
                max_iter=1000,
                C=2.0,
                multi_class="multinomial",
                solver="lbfgs",
            )),
        ])
        self._tfidf_pipeline.fit(X_train, y_train)
        self._tfidf_ready = True
        log.info("nlp_tfidf_ready")

    def _init_transformer(self) -> None:
        """Load DistilBERT for high-accuracy classification."""
        try:
            from transformers import pipeline as hf_pipeline
            # In production: use fine-tuned checkpoint from MODELS_DIR
            # Here we use zero-shot classification as a proxy
            self._transformer = hf_pipeline(
                "zero-shot-classification",
                model="typeform/distilbert-base-uncased-mnli",
                device=-1,  # CPU; set to 0 for GPU
            )
            self._transformer_ready = True
            log.info("nlp_transformer_ready")
        except Exception as e:
            log.warning("nlp_transformer_unavailable", error=str(e))

    def _init_spacy(self) -> None:
        """Load spaCy for NER."""
        try:
            import spacy
            self._nlp_spacy = spacy.load("en_core_web_sm")
            log.info("nlp_spacy_ready")
        except Exception as e:
            log.warning("nlp_spacy_unavailable", error=str(e))

    # ── Public interface ──────────────────────────────────────

    def analyze(self, text: str, language: str = "en") -> NLPResult:
        t0 = time.perf_counter()

        # Normalize
        clean_text = self._normalize(text)

        # Language detection
        detected_lang = self._detect_language(clean_text, language)

        # Classification
        classified_type, confidence = self._classify(clean_text)

        # Entity extraction
        entities = self._extract_entities(clean_text)

        # Sentiment / urgency
        sentiment, urgency = self._score_urgency(clean_text)

        # Medical sub-type
        medical_subtype = None
        if classified_type == "MEDICAL":
            medical_subtype = self._classify_medical_subtype(clean_text)

        # Keywords
        keywords = self._extract_keywords(clean_text)

        # Intent
        intent = f"REPORT_{classified_type}" if classified_type != "UNKNOWN" else "REPORT_INCIDENT"

        ms = (time.perf_counter() - t0) * 1000

        return NLPResult(
            original_text=text,
            translated_text=None,
            detected_language=detected_lang,
            confidence=confidence,
            entities=entities,
            intent=intent,
            sentiment=sentiment,
            keywords=keywords,
            classified_type=classified_type,
            classification_confidence=confidence,
            medical_subtype=medical_subtype,
            urgency_score=urgency,
            processing_ms=round(ms, 2),
        )

    # ── Classification ────────────────────────────────────────

    def _classify(self, text: str) -> Tuple[str, float]:
        """
        Two-tier classification:
          1. Try transformer (zero-shot) for high confidence
          2. Fall back to TF-IDF
          3. Boost confidence with keyword matching
        """
        transformer_result = None
        if self._transformer_ready:
            try:
                result = self._transformer(
                    text,
                    candidate_labels=INCIDENT_LABELS[:-1],  # exclude UNKNOWN
                    hypothesis_template="This emergency is about {}.",
                )
                top_label = result["labels"][0]
                top_score = result["scores"][0]
                transformer_result = (top_label, float(top_score))
            except Exception:
                pass

        # TF-IDF classification
        tfidf_label = "UNKNOWN"
        tfidf_proba = 0.0
        if self._tfidf_ready:
            try:
                proba = self._tfidf_pipeline.predict_proba([text])[0]
                classes = self._tfidf_pipeline.classes_
                idx = int(np.argmax(proba))
                tfidf_label = classes[idx]
                tfidf_proba = float(proba[idx])
            except Exception:
                pass

        # Keyword boost
        keyword_label, keyword_score = self._keyword_classify(text)

        # Ensemble: prefer transformer if confident, else blend TF-IDF + keywords
        if transformer_result and transformer_result[1] > 0.65:
            label, score = transformer_result
            # Boost if keywords agree
            if keyword_label == label:
                score = min(score + 0.1, 0.99)
            return label, score

        # Blend TF-IDF and keyword
        if tfidf_label == keyword_label and tfidf_label != "UNKNOWN":
            return tfidf_label, min((tfidf_proba + keyword_score) / 2 + 0.1, 0.95)

        if keyword_score > tfidf_proba and keyword_label != "UNKNOWN":
            return keyword_label, keyword_score

        if tfidf_proba > 0.4:
            return tfidf_label, tfidf_proba

        return "UNKNOWN", 0.3

    def _keyword_classify(self, text: str) -> Tuple[str, float]:
        lower = text.lower()
        best_label, best_score = "UNKNOWN", 0.0

        for label, keywords in KEYWORD_CORPUS.items():
            if not keywords:
                continue
            matches = sum(1 for kw in keywords if kw in lower)
            # Weight by phrase length (longer phrases = more specific)
            weighted = sum(len(kw.split()) for kw in keywords if kw in lower)
            score = min(0.3 + weighted * 0.08, 0.92)
            if matches > 0 and score > best_score:
                best_score = score
                best_label = label

        return best_label, best_score

    def _classify_medical_subtype(self, text: str) -> Optional[str]:
        lower = text.lower()
        for subtype, signals in MEDICAL_SUBTYPES.items():
            if any(s in lower for s in signals):
                return subtype
        return None

    # ── Entity extraction ─────────────────────────────────────

    def _extract_entities(self, text: str) -> List[Dict]:
        entities = []

        # spaCy NER (if available)
        if self._nlp_spacy:
            try:
                doc = self._nlp_spacy(text)
                for ent in doc.ents:
                    etype = self._map_spacy_entity(ent.label_)
                    if etype:
                        entities.append({
                            "type": etype,
                            "value": ent.text,
                            "confidence": 0.85,
                            "position": {"start": ent.start_char, "end": ent.end_char},
                        })
            except Exception:
                pass

        # Regex-based extraction (always runs, fills gaps)
        for etype, patterns in ENTITY_PATTERNS.items():
            # Skip if spaCy already found this type
            if any(e["type"] == etype for e in entities):
                continue
            for pattern in patterns:
                for match in re.finditer(pattern, text, re.IGNORECASE):
                    value = match.group(1) if match.lastindex else match.group(0)
                    if value and len(value.strip()) > 1:
                        entities.append({
                            "type": etype,
                            "value": value.strip(),
                            "confidence": 0.65,
                            "position": {"start": match.start(), "end": match.end()},
                        })
                        break  # one match per pattern per type

        return entities

    def _map_spacy_entity(self, label: str) -> Optional[str]:
        mapping = {
            "GPE": "LOCATION", "LOC": "LOCATION", "FAC": "LOCATION",
            "PERSON": "PERSON", "ORG": "LOCATION",
            "TIME": "TIME", "DATE": "TIME",
        }
        return mapping.get(label)

    # ── Urgency scoring ───────────────────────────────────────

    def _score_urgency(self, text: str) -> Tuple[str, float]:
        lower = text.lower()
        panic_count = sum(1 for s in PANIC_SIGNALS if s in lower)
        calm_count = sum(1 for s in CALM_SIGNALS if s in lower)

        # Caps lock ratio (all-caps words indicate panic)
        words = text.split()
        caps_ratio = sum(1 for w in words if w.isupper() and len(w) > 2) / max(len(words), 1)

        # Exclamation marks
        exclamation_score = min(text.count("!") * 0.1, 0.3)

        urgency = min(
            panic_count * 0.15 + caps_ratio * 0.3 + exclamation_score - calm_count * 0.05,
            1.0,
        )
        urgency = max(urgency, 0.0)

        if urgency > 0.6 or panic_count >= 3:
            sentiment = "PANIC"
        elif urgency > 0.3 or panic_count >= 1:
            sentiment = "URGENT"
        elif calm_count > panic_count:
            sentiment = "CALM"
        else:
            sentiment = "CONFUSED"

        return sentiment, round(urgency, 3)

    # ── Helpers ───────────────────────────────────────────────

    def _normalize(self, text: str) -> str:
        text = re.sub(r"\s+", " ", text.strip())
        text = re.sub(r"[^\w\s\.,!?@#\-']", " ", text)
        return text

    def _detect_language(self, text: str, hint: str) -> str:
        try:
            from langdetect import detect
            return detect(text)
        except Exception:
            return hint

    def _extract_keywords(self, text: str) -> List[str]:
        stop_words = {
            "the", "a", "an", "is", "are", "was", "were", "be", "been",
            "have", "has", "had", "do", "does", "did", "will", "would",
            "could", "should", "may", "might", "shall", "can", "need",
            "i", "me", "my", "we", "our", "you", "your", "he", "she",
            "it", "they", "them", "this", "that", "there", "here",
        }
        words = re.findall(r"\b[a-zA-Z]{3,}\b", text.lower())
        return list(dict.fromkeys(w for w in words if w not in stop_words))[:20]
