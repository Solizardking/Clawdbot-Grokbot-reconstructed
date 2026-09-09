import {queryGeneric as query,mutationGeneric as mutation} from 'convex/server';
import {v} from 'convex/values';
import {requireService} from './access';
export const list=query({args:{},handler:async(ctx)=>{
  const releases=await ctx.db.query('releases').filter(q=>q.eq(q.field('active'),true)).take(20);
  return releases.filter(r=>r.signed&&(r.platform!=='macos'||r.notarized)).map(({_id,version,platform,architecture,sha256,sizeBytes,publishedAt})=>({id:_id,version,platform,architecture,sha256,sizeBytes,publishedAt}));
}});
export const getDownload=query({args:{releaseId:v.id('releases')},handler:async(ctx,args)=>{
  await requireService(ctx);const release=await ctx.db.get(args.releaseId);
  if(!release?.active||!release.signed||release.platform==='macos'&&!release.notarized)return null;
  return release;
}});
export const track=mutation({args:{eventId:v.string(),releaseId:v.id('releases'),userId:v.optional(v.id('users'))},handler:async(ctx,args)=>{
  await requireService(ctx);
  if(!/^[a-f0-9]{64}$/.test(args.eventId))throw new Error('Invalid download event');
  const release=await ctx.db.get(args.releaseId);
  if(!release?.active||!release.signed||release.platform==='macos'&&!release.notarized)throw new Error('Release unavailable');
  const existing=await ctx.db.query('downloadEvents').withIndex('by_event',q=>q.eq('eventId',args.eventId)).unique();
  if(existing)return;
  await ctx.db.insert('downloadEvents',{...args,createdAt:Date.now(),kind:'download_requested'});
}});
