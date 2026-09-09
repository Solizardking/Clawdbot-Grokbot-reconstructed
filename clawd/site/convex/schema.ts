import {defineSchema,defineTable} from 'convex/server';
import {v} from 'convex/values';

export default defineSchema({
  mobileChallenges:defineTable({challengeId:v.string(),browserHash:v.string(),input:v.string(),expiresAt:v.number(),consumedAt:v.optional(v.number())}).index('by_challenge',['challengeId']).index('by_expiry',['expiresAt']),
  users:defineTable({wallet:v.string(),createdAt:v.number(),lastLoginAt:v.number()}).index('by_wallet',['wallet']),
  loginChallenges:defineTable({challengeId:v.string(),wallet:v.string(),message:v.string(),browserHash:v.string(),expiresAt:v.number(),consumedAt:v.optional(v.number())}).index('by_challenge',['challengeId']).index('by_expiry',['expiresAt']),
  sessions:defineTable({tokenHash:v.string(),userId:v.id('users'),createdAt:v.number(),expiresAt:v.number(),revokedAt:v.optional(v.number())}).index('by_hash',['tokenHash']).index('by_user',['userId']).index('by_expiry',['expiresAt']),
  rateLimits:defineTable({key:v.string(),windowAt:v.number(),count:v.number()}).index('by_key',['key']).index('by_window',['windowAt']),
  subscriptions:defineTable({userId:v.id('users'),planId:v.string(),expiresAt:v.number(),updatedAt:v.number(),lastPaymentId:v.string()}).index('by_user',['userId']),
  invoices:defineTable({invoiceId:v.string(),userId:v.id('users'),network:v.string(),mint:v.string(),receiver:v.string(),amountAtomic:v.string(),periodDays:v.number(),reference:v.string(),createdAt:v.number(),expiresAt:v.number(),status:v.union(v.literal('pending'),v.literal('settled')),signature:v.optional(v.string()),settledAt:v.optional(v.number())}).index('by_invoice',['invoiceId']).index('by_user',['userId']).index('by_signature',['signature']),
  releases:defineTable({version:v.string(),platform:v.string(),architecture:v.string(),url:v.string(),sha256:v.string(),sizeBytes:v.number(),publishedAt:v.number(),signed:v.boolean(),notarized:v.boolean(),active:v.boolean()}).index('by_target',['platform','architecture','active']),
  downloadEvents:defineTable({eventId:v.string(),releaseId:v.id('releases'),userId:v.optional(v.id('users')),createdAt:v.number(),kind:v.union(v.literal('download_requested'),v.literal('installed')),installHash:v.optional(v.string())}).index('by_event',['eventId']).index('by_release',['releaseId','createdAt']).index('by_install',['installHash']),
});
