import { timingSafeEqual } from "node:crypto";

export interface ApiTokenSource { list(): Promise<unknown[]>; }
export interface ApiServerDependencies { token?: string; source?: ApiTokenSource; }
export interface ApiServer { fetch(request: Request): Promise<Response>; }
function unauthorized():Response{return Response.json({error:{code:"UNAUTHORIZED",message:"Missing or invalid identity."}},{status:401});}
function equalSecret(a:string,b:string):boolean{const aa=Buffer.from(a),bb=Buffer.from(b);return aa.length===bb.length&&timingSafeEqual(aa,bb);}
export function createServer(deps:ApiServerDependencies={}):ApiServer{
 return {async fetch(request:Request):Promise<Response>{const path=new URL(request.url).pathname;
  if(request.method==="GET"&&path==="/api/health")return Response.json({status:"ok",service:"rq-sys-api"});
  if(request.method==="GET"&&path==="/api/health/ready")return Response.json({status:"not_ready",reason:"database_unavailable_or_not_configured"},{status:503});
  if(path.startsWith("/api/")){const authorization=request.headers.get("authorization")??"";const token=deps.token??process.env.RQSYS_API_TOKEN;if(!token||!authorization.startsWith("Bearer ")||!equalSecret(authorization.slice(7),token))return unauthorized();}
  if(request.method==="GET"&&path==="/api/sources"){if(!deps.source)return Response.json({error:{code:"DEPENDENCY_UNAVAILABLE",message:"Source repository is unavailable."}},{status:503});return Response.json({items:await deps.source.list()});}
  return Response.json({error:{code:"ROUTE_NOT_IMPLEMENTED",message:"This endpoint is not configured in this server entry."}},{status:501});
 }};
}
