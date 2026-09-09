import {mutationGeneric as mutation,queryGeneric as query} from 'convex/server';
import {v} from 'convex/values';
import {requireService,requireWallet} from './access';
const hash=v.string();
const hashPattern=/^[a-f0-9]{64}$/;

export const challenge=mutation({args:{challengeId:v.string(),wallet:v.string(),message:v.string(),browserHash:hash,rateKey:hash},handler:async(ctx,args)=>{
  await requireService(ctx);
  if(!hashPattern.test(args.browserHash)||!hashPattern.test(args.rateKey)||args.message.length>2000||args.challengeId.length!==43||!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(args.wallet))throw new Error('Invalid challenge');
  const now=Date.now(),key='login:'+args.rateKey;
  const limit=await ctx.db.query('rateLimits').withIndex('by_key',q=>q.eq('key',key)).unique();
  if(limit&&now-limit.windowAt<60000){if(limit.count>=10)throw new Error('Rate limit reached');await ctx.db.patch(limit._id,{count:limit.count+1});}
  else if(limit)await ctx.db.patch(limit._id,{windowAt:now,count:1});
  else await ctx.db.insert('rateLimits',{key,windowAt:now,count:1});
  await ctx.db.insert('loginChallenges',{challengeId:args.challengeId,wallet:args.wallet,message:args.message,browserHash:args.browserHash,expiresAt:now+300000});
  return {expiresAt:now+300000};
}});
export const getChallenge=query({args:{challengeId:v.string(),browserHash:hash},handler:async(ctx,args)=>{
  await requireService(ctx);
  const row=await ctx.db.query('loginChallenges').withIndex('by_challenge',q=>q.eq('challengeId',args.challengeId)).unique();
  if(!row||row.consumedAt!==undefined||row.expiresAt<=Date.now()||row.browserHash!==args.browserHash)return null;
  return {wallet:row.wallet,message:row.message,expiresAt:row.expiresAt};
}});
export const finishLogin=mutation({args:{challengeId:v.string(),browserHash:hash,tokenHash:hash},handler:async(ctx,args)=>{
  await requireService(ctx);
  if(!hashPattern.test(args.tokenHash))throw new Error('Invalid session');
  const now=Date.now(),challenge=await ctx.db.query('loginChallenges').withIndex('by_challenge',q=>q.eq('challengeId',args.challengeId)).unique();
  if(!challenge||challenge.consumedAt!==undefined||challenge.expiresAt<=now||challenge.browserHash!==args.browserHash)throw new Error('Login challenge expired or already used');
  await ctx.db.patch(challenge._id,{consumedAt:now});
  const user=await ctx.db.query('users').withIndex('by_wallet',q=>q.eq('wallet',challenge.wallet)).unique();
  const userId=user?user._id:await ctx.db.insert('users',{wallet:challenge.wallet,createdAt:now,lastLoginAt:now});
  if(user)await ctx.db.patch(user._id,{lastLoginAt:now});
  const expiresAt=now+7*86400000;
  await ctx.db.insert('sessions',{tokenHash:args.tokenHash,userId,createdAt:now,expiresAt});
  return {wallet:challenge.wallet,expiresAt};
}});
export const session=query({args:{tokenHash:hash},handler:async(ctx,args)=>{
  await requireService(ctx);
  if(!hashPattern.test(args.tokenHash))return null;
  const row=await ctx.db.query('sessions').withIndex('by_hash',q=>q.eq('tokenHash',args.tokenHash)).unique();
  if(!row||row.revokedAt!==undefined||row.expiresAt<=Date.now())return null;
  const user=await ctx.db.get(row.userId);return user?{wallet:user.wallet,userId:user._id,expiresAt:row.expiresAt}:null;
}});
export const logout=mutation({args:{tokenHash:hash},handler:async(ctx,args)=>{
  await requireService(ctx);
  const row=await ctx.db.query('sessions').withIndex('by_hash',q=>q.eq('tokenHash',args.tokenHash)).unique();
  if(row)await ctx.db.patch(row._id,{revokedAt:Date.now()});
}});
export const me=query({args:{},handler:async(ctx)=>{
  const wallet=await requireWallet(ctx);
  const user=await ctx.db.query('users').withIndex('by_wallet',q=>q.eq('wallet',wallet)).unique();
  if(!user)return null;
  const subscription=await ctx.db.query('subscriptions').withIndex('by_user',q=>q.eq('userId',user._id)).unique();
  return {wallet,createdAt:user.createdAt,subscription:subscription?{planId:subscription.planId,expiresAt:subscription.expiresAt,active:subscription.expiresAt>Date.now()}:null};
}});

export const gatewayAccess=mutation({args:{tokenHash:hash},handler:async(ctx,args)=>{
  await requireService(ctx);
  if(!hashPattern.test(args.tokenHash))return null;
  const now=Date.now(),session=await ctx.db.query('sessions').withIndex('by_hash',q=>q.eq('tokenHash',args.tokenHash)).unique();
  if(!session||session.revokedAt!==undefined||session.expiresAt<=now)return null;
  const user=await ctx.db.get(session.userId);
  if(!user)return null;
  const subscription=await ctx.db.query('subscriptions').withIndex('by_user',q=>q.eq('userId',user._id)).unique();
  if(!subscription||subscription.expiresAt<=now)return {status:'subscription_required' as const};
  const key='gateway:'+user._id,limit=await ctx.db.query('rateLimits').withIndex('by_key',q=>q.eq('key',key)).unique();
  if(limit&&now-limit.windowAt<60000){
    if(limit.count>=12)return {status:'rate_limited' as const};
    await ctx.db.patch(limit._id,{count:limit.count+1});
  }else if(limit)await ctx.db.patch(limit._id,{windowAt:now,count:1});
  else await ctx.db.insert('rateLimits',{key,windowAt:now,count:1});
  return {status:'ready' as const,wallet:user.wallet,planId:subscription.planId,expiresAt:Math.min(now+300000,session.expiresAt,subscription.expiresAt)};
}});
