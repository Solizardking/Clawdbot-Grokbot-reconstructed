import {expect,it} from 'vitest';
import {convexTest} from 'convex-test';
import {makeFunctionReference} from 'convex/server';
import schema from '../convex/schema';
const modules=import.meta.glob('../convex/**/*.ts');
const list=makeFunctionReference<'query'>('releases:list');
const track=makeFunctionReference<'mutation'>('releases:track');
const release={version:'1.0.0',platform:'macos',architecture:'arm64',url:'https://downloads.example/clawd.dmg',sha256:'f'.repeat(64),sizeBytes:123456,publishedAt:Date.now(),signed:true,notarized:true,active:true};
it('publishes only reviewed releases, records requests idempotently, rejects public writes',async()=>{
  const t=convexTest(schema,modules);
  const [id,unsigned]=await t.run(async ctx=>[
    await ctx.db.insert('releases',release),
    await ctx.db.insert('releases',{...release,signed:false}),
    await ctx.db.insert('releases',{...release,notarized:false}),
  ]);
  const rows=await t.query(list,{});
  expect(rows.map((r:{id:string})=>r.id)).toEqual([id]);
  const event={releaseId:id,eventId:'e'.repeat(64)};
  await expect(t.mutation(track,event)).rejects.toThrow('Unauthorized');
  const service=t.withIdentity({subject:'service:clawd-site',role:'service'});
  await expect(service.mutation(track,{...event,releaseId:unsigned})).rejects.toThrow('Release unavailable');
  await service.mutation(track,event);await service.mutation(track,event);
  const events=await t.run(ctx=>ctx.db.query('downloadEvents').collect());
  expect(events).toHaveLength(1);expect(events[0].kind).toBe('download_requested');
});
