import {mutationGeneric as mutation,queryGeneric as query} from 'convex/server';
import {v} from 'convex/values';
import {requireService} from './access';
export const prepare=mutation({args:{challengeId:v.string(),browserHash:v.string(),rateKey:v.string(),input:v.string()},handler:async(ctx,args)=>{
  await requireService(ctx);
  if(!/^[A-Za-z0-9_-]{43}$/.test(args.challengeId)||!/^[a-f0-9]{64}$/.test(args.browserHash)||!/^[a-f0-9]{64}$/.test(args.rateKey)||args.input.length>2000)throw new Error('Invalid challenge');
  const now=Date.now(),key='mobile-login:'+args.rateKey;
  const rate=await ctx.db.query('rateLimits').withIndex('by_key',q=>q.eq('key',key)).unique();
  if(rate&&now-rate.windowAt<60000){if(rate.count>=10)throw new Error('Rate limit reached');await ctx.db.patch(rate._id,{count:rate.count+1});}
  else if(rate)await ctx.db.patch(rate._id,{windowAt:now,count:1});
  else await ctx.db.insert('rateLimits',{key,windowAt:now,count:1});
  await ctx.db.insert('mobileChallenges',{challengeId:args.challengeId,browserHash:args.browserHash,input:args.input,expiresAt:now+300000});
}});
export const get=query({args:{challengeId:v.string(),browserHash:v.string()},handler:async(ctx,args)=>{
  await requireService(ctx);const row=await ctx.db.query('mobileChallenges').withIndex('by_challenge',q=>q.eq('challengeId',args.challengeId)).unique();
  return row&&row.browserHash===args.browserHash&&row.consumedAt===undefined&&row.expiresAt>Date.now()?{input:row.input}:null;
}});
export const finish=mutation({args:{challengeId:v.string(),browserHash:v.string(),wallet:v.string(),tokenHash:v.string()},handler:async(ctx,args)=>{
  await requireService(ctx);
  if(!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(args.wallet)||!/^[a-f0-9]{64}$/.test(args.tokenHash))throw new Error('Invalid session');
  const now=Date.now(),row=await ctx.db.query('mobileChallenges').withIndex('by_challenge',q=>q.eq('challengeId',args.challengeId)).unique();
  if(!row||row.browserHash!==args.browserHash||row.consumedAt!==undefined||row.expiresAt<=now)throw new Error('Login challenge expired or already used');
  await ctx.db.patch(row._id,{consumedAt:now});
  const user=await ctx.db.query('users').withIndex('by_wallet',q=>q.eq('wallet',args.wallet)).unique();
  const userId=user?user._id:await ctx.db.insert('users',{wallet:args.wallet,createdAt:now,lastLoginAt:now});
  if(user)await ctx.db.patch(user._id,{lastLoginAt:now});
  await ctx.db.insert('sessions',{tokenHash:args.tokenHash,userId,createdAt:now,expiresAt:now+7*86400000});
}});
