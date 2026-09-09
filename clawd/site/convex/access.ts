import type {GenericQueryCtx,GenericDataModel} from 'convex/server';
type AuthContext=Pick<GenericQueryCtx<GenericDataModel>,'auth'>;
export async function requireService(ctx:AuthContext){
  const identity=await ctx.auth.getUserIdentity();
  if(identity?.subject!=='service:clawd-site'||identity.role!=='service')throw new Error('Unauthorized');
}
export async function requireWallet(ctx:AuthContext){
  const identity=await ctx.auth.getUserIdentity();
  if(identity?.role!=='wallet'||!identity.subject.startsWith('wallet:'))throw new Error('Not authenticated');
  return identity.subject.slice('wallet:'.length);
}
