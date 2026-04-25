// ============================================================
// LIFEGRID – MongoDB User Schema
// Stores user profiles, preferences, and activity
// ============================================================

import mongoose, { Schema, Document, Model } from 'mongoose';

export interface IUser extends Document {
  userId:       string;
  email:        string;
  phone?:       string;
  name:         string;
  role:         string;
  language:     string;
  passwordHash: string;
  isVerified:   boolean;
  isActive:     boolean;
  mfaEnabled:   boolean;
  mfaSecret?:   string;
  permissions:  string[];
  preferences: {
    notifications: { push: boolean; sms: boolean; email: boolean };
    language:      string;
    theme:         string;
  };
  deviceTokens:  string[];   // FCM tokens for push notifications
  lastLoginAt?:  Date;
  lastLoginIp?:  string;
  failedLogins:  number;
  lockedUntil?:  Date;
  reportedIncidents: string[];
  createdAt:     Date;
  updatedAt:     Date;
}

const UserSchema = new Schema<IUser>(
  {
    userId:       { type: String, required: true, unique: true, index: true },
    email:        { type: String, required: true, unique: true, index: true, lowercase: true, trim: true },
    phone:        { type: String, sparse: true, index: true },
    name:         { type: String, required: true },
    role:         { type: String, required: true, default: 'CITIZEN', index: true },
    language:     { type: String, default: 'en' },
    passwordHash: { type: String, required: true, select: false },  // Never returned by default
    isVerified:   { type: Boolean, default: false },
    isActive:     { type: Boolean, default: true, index: true },
    mfaEnabled:   { type: Boolean, default: false },
    mfaSecret:    { type: String, select: false },
    permissions:  [String],

    preferences: {
      notifications: {
        push:  { type: Boolean, default: true },
        sms:   { type: Boolean, default: true },
        email: { type: Boolean, default: false },
      },
      language: { type: String, default: 'en' },
      theme:    { type: String, default: 'light' },
    },

    deviceTokens:      [String],
    lastLoginAt:       Date,
    lastLoginIp:       String,
    failedLogins:      { type: Number, default: 0 },
    lockedUntil:       Date,
    reportedIncidents: [String],
  },
  {
    timestamps: true,
    collection: 'users',
  },
);

UserSchema.index({ role: 1, isActive: 1 });

export const UserModel: Model<IUser> = mongoose.model<IUser>('User', UserSchema);
