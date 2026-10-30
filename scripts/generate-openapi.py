from pathlib import Path
import json,re
S=lambda desc='':{'type':'string','maxLength':8192,**({'description':desc} if desc else {})}
I={'type':'integer','minimum':1};B={'type':'boolean'}
ref=lambda name:{'$ref':'./'+name+'.schema.json'}
R={'expected_revision':I}
def obj(fields,required=None):return {'type':'object','properties':fields,'required':list(fields) if required is None else required,'additionalProperties':False}
representation={'type':'object','additionalProperties':False,'required':['kind'],'properties':{k:{'$ref':'./decision.v1.schema.json#/properties/representation/properties/'+k} for k in ['kind','transform_id','parameters']}}
requests={
'providerCheck':obj({}),'saveRule':obj({'task_id':S(),'candidate_id':S(),'decision_id':S(),'expected_revision':I}),'ruleVersion':obj({'expected_rule_version':I,'expires_at':{'type':['string','null'],'format':'date-time'}}),
'create':obj({x:S() for x in ['internal_title','project_id','purpose_id','recipient_id','audience','output_language']}|{'skill_ids':{'type':'array','items':S(),'maxItems':0}}),
'patch':obj(R|{x:S() for x in ['internal_title','recipient_id','audience','purpose_id','output_language']}|{'skill_ids':{'type':'array','items':S(),'maxItems':0}},['expected_revision']),
'addCatalog':obj({'display_name':S()}),
'removeSource':obj(R),
'manual':obj(R|{'statement':S(),'kind':{'enum':['observation','constraint','unknown','identifier']},'evidence_ids':{'type':'array','items':S()},'user_note':S()},['expected_revision','statement','kind']),
'preview':obj(R|{'candidate_id':S(),'representation':representation,'raw_grants':{'type':'array','items':{'$ref':'./decision.v1.schema.json#/properties/raw_grants/items'}}},['expected_revision','candidate_id','representation']),
'decide':obj(R|{'operations':{'type':'array','minItems':1,'maxItems':30,'items':obj({'candidate_id':S(),'disposition':{'enum':['allow','exclude','defer']},'representation':representation,'preview_id':S(),'projection_sha256':S(),'save_reusable_rule':B,'applied_rule_id':S(),'applied_rule_version':I,'raw_grants':{'type':'array','maxItems':1,'items':{'$ref':'./decision.v1.schema.json#/properties/raw_grants/items'}},'expires_at':{'type':['string','null'],'format':'date-time'}},['candidate_id','disposition'])}}),
'revokeDecision':obj(R),'startJob':obj(R|{'kind':{'enum':['analyze','compose','review','reproduce','interpret_disclosure']},'arguments':obj({'candidate_id':S(),'text':S(),'seed':{'type':'integer','minimum':0}},[])}),'cancelJob':obj(R),
'edit':obj(R|{'expected_document_hash':S(),'document':ref('draft.v1')}),
'finalize':obj(R|{'expected_artifact_set_hash':S(),'confirmed':B}),
'humanReview':obj(R|{'expected_artifact_set_hash':S(),'fallback_reason':S(),'confirmed':B}),
'revokeRule':obj({'expected_rule_version':I}),
}
routes=[]
src=Path('internal/httpapi/server.go').read_text()
for meth,path,handler in re.findall(r'm.HandleFunc\("(GET|POST|PATCH|PUT|DELETE) ([^"]+)", s\.(\w+)\)',src):
 if path.startswith('/api/v1'):routes.append((meth,path,handler))
for p in ['/api/v1/session','/api/v1/health','/health']:routes.append(('GET',p,p.split('/')[-1]))
paths={}
for method,path,handler in routes:
 params=[{'name':v,'in':'path','required':True,'schema':S()} for v in re.findall(r'{(\w+)}',path)]
 if method!='GET':params.append({'name':'Idempotency-Key','in':'header','required':True,'schema':{'type':'string','maxLength':160}});params.append({'name':'X-CSRF-Token','in':'header','required':True,'schema':S()})
 status='202' if handler in ['startJob','providerCheck'] else '201' if handler in ['create','sources','manual','finalize','addCatalog','saveRule','ruleVersion'] else '200'
 responses={status:{'description':'정상 응답. data 객체. 파일 응답은 실제 저장 바이트.', 'content':{'application/json':{'schema':{'type':'object','required':['data'],'properties':{'data':{}},'additionalProperties':False}}}},'400':{'$ref':'#/components/responses/Error'},'403':{'$ref':'#/components/responses/Error'},'404':{'$ref':'#/components/responses/Error'},'409':{'$ref':'#/components/responses/Error'},'413':{'$ref':'#/components/responses/Error'},'415':{'$ref':'#/components/responses/Error'},'422':{'$ref':'#/components/responses/Error'},'503':{'$ref':'#/components/responses/Error'},'500':{'$ref':'#/components/responses/Error'}}
 response_schema={'create':ref('task.v1'),'get':ref('task.v1'),'patch':ref('task.v1'),'list':{'type':'array','items':ref('task.v1')},'startJob':ref('job.v1'),'job':ref('job.v1'),'cancelJob':ref('job.v1'),'providerCheck':ref('job.v1'),'getArtifact':ref('artifact.v1'),'edit':ref('artifact.v1'),'humanReview':ref('artifact.v1'),'saveRule':ref('rule.v1'),'ruleVersion':ref('rule.v1'),'rules':{'type':'array','items':ref('rule.v1')},'preview':ref('disclosure_preview.v1')}.get(handler,{})
 responses[status]['content']['application/json']['schema']['properties']['data']=response_schema
 op={'operationId':handler,'summary':handler+' (구현된 API)','parameters':params,'responses':responses}
 if handler in requests:op['requestBody']={'required':True,'content':{'application/json':{'schema':requests[handler]}}}
 if handler=='sources':op['requestBody']={'required':True,'content':{'multipart/form-data':{'schema':{'type':'object','required':['meta'],'properties':{'meta':{'type':'string','description':'expected_revision, items[{client_key,display_name,format,source_slot,replace_source_id?}] JSON. 각 client_key가 파일 필드 이름이다.'}},'additionalProperties':{'type':'string','format':'binary'}}}}}
 if handler=='events':op['responses']['200']['content']={'text/event-stream':{'schema':S()}};op['parameters'].append({'name':'Last-Event-ID','in':'header','schema':S()})
 if handler in ['download','previewFile','source']:op['responses']['200']['content']={'application/octet-stream':{'schema':{'type':'string','format':'binary'}}}
 paths.setdefault(path,{})[method.lower()]=op
out={'openapi':'3.1.0','info':{'title':'SafeHandoff 실제 API','version':'0.1.0','description':'로컬 단일 사용자. 먼저 GET /api/v1/session으로 세션 쿠키와 CSRF 토큰을 얻는다. 변경 요청에는 토큰, 멱등 키, 현재 판본이 필요하다. 모델 계약과 API DTO는 별개다.'},'servers':[{'url':'http://127.0.0.1:8080'}],'paths':paths,'components':{'responses':{'Error':{'description':'안전한 앱 오류. 원문·공급자 오류·인증 값을 포함하지 않는다.','content':{'application/json':{'schema':obj({'error':obj({'code':S(),'message':S(),'retryable':B})})}}}}}}
Path('contracts/openapi.json').write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n')
