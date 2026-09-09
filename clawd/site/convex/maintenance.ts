import {internalMutation} from './_generated/server';
// Bound each scheduled run so expired authentication records cannot grow forever.
export const purgeExpired=internalMutation({args:{},handler:async(ctx)=>{
  const now=Date.now();
  const challenges=await ctx.db.query('loginChallenges').withIndex('by_expiry',q=>q.lt('expiresAt',now)).take(500);
  const mobile=await ctx.db.query('mobileChallenges').withIndex('by_expiry',q=>q.lt('expiresAt',now)).take(500);
  const sessions=await ctx.db.query('sessions').withIndex('by_expiry',q=>q.lt('expiresAt',now)).take(500);
  const limits=await ctx.db.query('rateLimits').withIndex('by_window',q=>q.lt('windowAt',now-86400000)).take(500);
  for(const row of [...challenges,...mobile,...sessions,...limits])await ctx.db.delete(row._id);
  return {challenges:challenges.length,sessions:sessions.length,limits:limits.length};
}});
