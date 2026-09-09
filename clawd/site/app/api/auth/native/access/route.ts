import {gatewayAccessResponse} from '@/lib/gateway-access';
export const POST=(request:Request)=>gatewayAccessResponse(request,true);
