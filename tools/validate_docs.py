#!/usr/bin/env python3
"""Validate the documentation package, not the SafeHandoff application.

Uses only Python's standard library. No network, model call or source upload.
Run: python3 tools/validate_docs.py
"""
from pathlib import Path
from decimal import Decimal, ROUND_HALF_UP
import csv
import json
import re
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
errors = []
checks = {}

def check(condition, message):
    if not condition:
        errors.append(message)

def load_json(path):
    def unique_pairs(pairs):
        result = {}
        for k, v in pairs:
            if k in result:
                raise ValueError('duplicate key: ' + k)
            result[k] = v
        return result
    return json.loads(path.read_text(encoding='utf-8'), object_pairs_hook=unique_pairs)

# Scope validation to imported design documents, excluding runtime reports/contracts.
manifest = ROOT/'tools/documentation-files.txt'
document_files = [ROOT/line for line in manifest.read_text().splitlines() if line]
markdown = sorted(p for p in document_files if p.suffix == '.md')
json_files = sorted(p for p in document_files if p.suffix == '.json')
json_documents = {}
for path in json_files:
    try:
        json_documents[str(path.relative_to(ROOT))] = load_json(path)
    except Exception as exc:
        errors.append(f'{path.relative_to(ROOT)}: JSON error: {exc}')
checks['json_files_parsed'] = len(json_documents)

link_count = 0
for path in markdown:
    source = path.read_text(encoding='utf-8')
    source = re.sub(r'```[^\n]*\n.*?```', '', source, flags=re.S)
    source = re.sub(r'~~~[^\n]*\n.*?~~~', '', source, flags=re.S)
    for target in re.findall(r'(?<!!)\[[^\]]+\]\(([^)]+)\)', source):
        target = target.split(' "')[0]
        if re.match(r'^[a-z][a-z0-9+.-]*:', target, flags=re.I) or target.startswith('#'):
            continue
        relative = target.split('#', 1)[0]
        if not relative:
            continue
        link_count += 1
        check((path.parent / relative).exists(), f'{path.relative_to(ROOT)}: broken link {target}')
checks['relative_file_links_checked'] = link_count
checks['markdown_files_checked'] = len(markdown)

features = sorted((ROOT/'docs/features').glob('[0-9][0-9]-*.md'))
features = [p for p in features if not p.name.startswith('00-')]
acceptance = {}
for path in features:
    source = path.read_text()
    headings = set(re.findall(r'^## (\d+)\.', source, re.M))
    check(set(map(str, range(1, 10))).issubset(headings), f'{path.name}: required feature sections missing')
    for acid in re.findall(r'^\| (AC-F\d\d-\d\d) \|', source, re.M):
        check(acid not in acceptance, f'duplicate acceptance id: {acid}')
        acceptance[acid] = str(path.relative_to(ROOT/'docs'))
qa_text = (ROOT/'docs/qa.md').read_text()
qa_ids = re.findall(r'^\| (T\d\d) \|', qa_text, re.M)
check(len(qa_ids) == len(set(qa_ids)), 'duplicate QA IDs')
check(set(qa_ids) == {f'T{i:02}' for i in range(1, 61)}, 'T01..T60 coverage changed')
with (ROOT/'docs/acceptance-map.csv').open(newline='') as f:
    mapped = list(csv.DictReader(f))
check({x['acceptance_id'] for x in mapped} == set(acceptance), 'AC map does not cover all actual AC IDs')
for row in mapped:
    check(row['feature_file'] == acceptance.get(row['acceptance_id']), f"AC path mismatch {row['acceptance_id']}")
    check(bool(row['test_ids']) and set(row['test_ids'].split(';')) <= set(qa_ids), f"AC invalid T mapping {row['acceptance_id']}")
    check(row['execution_status'] == 'not_run', 'document package must not claim product tests ran')
with (ROOT/'docs/traceability.csv').open(newline='') as f:
    trace = list(csv.DictReader(f))
check({x['test_id'] for x in trace} == set(qa_ids), 'traceability lacks QA IDs')
for row in trace:
    wanted = {x['acceptance_id'] for x in mapped if row['test_id'] in x['test_ids'].split(';')}
    actual = set(filter(None, row['acceptance_ids'].split(';')))
    check(wanted == actual, f"reverse mapping mismatch {row['test_id']}")
    check(row['execution_status'] == 'not_run', 'product test marked as executed')
checks['feature_count'] = len(features)
checks['acceptance_criteria_mapped'] = len(acceptance)
checks['qa_scenarios_defined_not_executed'] = len(qa_ids)

domain = json_documents.get('contracts/domain-contract.json', {})
schema = json_documents.get('contracts/core.schema.json', {})
defs = schema.get('$defs', {})
def inspect_schema(node, path='$'):
    if isinstance(node, dict):
        if '$ref' in node and node['$ref'].startswith('#/$defs/'):
            check(node['$ref'].split('/')[-1] in defs, f'unresolved schema ref at {path}')
        if 'properties' in node and 'required' in node:
            check(set(node['required']) <= set(node['properties']), f'invalid required property in {path}')
        for k, v in node.items():
            inspect_schema(v, path+'.'+k)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            inspect_schema(v, path+f'[{i}]')
inspect_schema(schema)
checks['schema_internal_definitions_checked'] = len(defs)
# Check the authored model examples for the named mandatory keys. This is
# deliberately not claimed as full JSON Schema validation.
model_text = (ROOT/'docs/agent-workflow.md').read_text()
example_count = 0
for block in re.findall(r'```json\n(.*?)\n```', model_text, re.S):
    example = json.loads(block)
    if example.get('schema_version') == 'candidate_proposals.v1':
        for item in example['candidates']:
            check(set(defs['candidate_proposal']['required']) <= set(item), 'candidate example missing required keys')
    if example.get('schema_version') == 'draft.v1':
        for b in example['blocks']:
            check(b['type'] in {'heading','paragraph','list','table_ref','excerpt_ref','asset_ref'}, 'invalid draft example block')
    example_count += 1
checks['model_json_examples_parsed_and_key_checked'] = example_count

for relative in ['fixtures/reference-pack/author/b2b-timeout/request-summary.csv', 'fixtures/reference-pack/author/internal-operations/requests.csv']:
    with (ROOT/relative).open(newline='') as f:
        rows = list(csv.DictReader(f))
    check(list(rows[0]) == ['observed_at','count'], f'{relative}: requests_v1 header mismatch')
    values = [int(x['count']) for x in rows]
    check(values == [820,1160,1740], f'{relative}: example values differ')
    index = [int((Decimal(x)*100/Decimal(values[0])).quantize(Decimal(1), rounding=ROUND_HALF_UP)) for x in values]
    check(index == [100,141,212], 'relative index mismatch')
    check(all(0 <= x <= domain['limits']['max_series_count'] for x in values), 'count beyond documented domain')
for path in json_files:
    if path.parent != ROOT/'evaluation/expected':
        continue
    expected = json_documents[str(path.relative_to(ROOT))]
    purpose = expected.get('purpose_id')
    goal = expected.get('goal_variant')
    check(goal in domain['purpose_goal_variants'].get(purpose, []), f'{path.name}: incompatible purpose/goal')
checks['scenario_math_and_goal_combinations'] = 'checked'

# Execute the reference DDL and test selected structural constraints. These
# are database design checks, not application integration/security tests.
db = sqlite3.connect(':memory:', isolation_level=None)
db.executescript((ROOT/'contracts/schema.sql').read_text())
check(db.execute('PRAGMA foreign_keys').fetchone()[0] == 1, 'foreign keys disabled')
table_count = db.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table'").fetchone()[0]
def expect_integrity(statement, params=()):
    try:
        db.execute(statement, params)
        errors.append('expected IntegrityError: '+statement[:100])
    except sqlite3.IntegrityError:
        pass

task_sql = """INSERT INTO tasks(id,internal_title,project_id,purpose_id,goal_variant,recipient_id,audience,revision,phase,output_language,skill_ids_json,skill_set_hash,provider_mode,created_at,updated_at)
VALUES(?, 'demo','project_demo','vendor_support','default','vendor_lab','named_external',1,'needs_analysis','ko','[]',?,'fixture','2026-10-31T00:00:00Z','2026-10-31T00:00:00Z')"""
digest='0'*64
db.execute(task_sql, ('task_a',digest))
db.execute(task_sql, ('task_b',digest))
expect_integrity("UPDATE tasks SET phase='unknown_phase' WHERE id='task_a'")
expect_integrity("UPDATE tasks SET revision=0 WHERE id='task_a'")
expect_integrity("INSERT INTO jobs(id,task_id,input_revision,kind,status,mode,snapshot_json,created_at) VALUES('bad_job','task_a',NULL,'analyze','queued','fixture','{}','2026-10-31T00:00:00Z')")
db.execute("INSERT INTO jobs(id,task_id,input_revision,kind,status,mode,snapshot_json,created_at) VALUES('job_a','task_a',1,'analyze','queued','fixture','{}','2026-10-31T00:00:00Z')")
source_sql="""INSERT INTO source_versions(id,task_id,source_id,version,source_slot,format,display_name,raw_bytes,size_bytes,sha256,parser_version,created_at)
VALUES(?,?,?,1,'notes','txt','demo.txt',?,3,?,'v1','2026-10-31T00:00:00Z')"""
db.execute(source_sql, ('srcv_a','task_a','src_a',b'abc',digest))
db.execute(source_sql, ('srcv_b','task_b','src_b',b'abc',digest))
expect_integrity("INSERT INTO task_sources VALUES('task_a','src_b','srcv_b',1)")
expect_integrity("UPDATE source_versions SET size_bytes=4 WHERE id='srcv_a'")
db.execute("INSERT INTO task_sources VALUES('task_a','src_a','srcv_a',1)")
db.execute("INSERT INTO evidence VALUES('ev_a','task_a','srcv_a','{}',?)",(digest,))
db.execute("INSERT INTO candidate_sets VALUES('set_a','task_a','job_a',?,1,'2026-10-31T00:00:00Z')",(digest,))
db.execute("INSERT INTO candidates VALUES('cand_a','task_a','set_a','observation','observed','required','model','{}')")
db.execute("INSERT INTO decisions(id,task_id,candidate_id,created_revision,disposition,payload_json,created_at) VALUES('dec_a','task_a','cand_a',1,'allow','{}','2026-10-31T00:00:00Z')")
db.execute("INSERT INTO rules VALUES('rule_a',1,?,'{}','task_a','dec_a',NULL,NULL,'2026-10-31T00:00:00Z')",(digest,))
db.execute("INSERT INTO current_decisions VALUES('task_a','cand_a','dec_a')")
db.execute("INSERT INTO fact_packs VALUES('pack_a','task_a',1,?,'{}','{}','2026-10-31T00:00:00Z')",(digest,))
db.execute("INSERT INTO artifacts VALUES('artifact_a','task_a',1,1,'pack_a','{}',?,?,'ready','{}','2026-10-31T00:00:00Z')",(digest,digest))
db.execute("INSERT INTO artifact_files VALUES('file_a','artifact_a','issue.md','text/markdown',?,3,?,'{}')",(b'abc',digest))
expect_integrity("INSERT INTO artifact_files VALUES('file_duplicate','artifact_a','issue.md','text/markdown',?,3,?,'{}')",(b'abc',digest))
db.execute("INSERT INTO exports VALUES('export_a','task_a',1,'artifact_a',?,?,?,'2026-10-31T00:00:00Z',NULL,NULL)",(digest,b'zip',digest))
db.execute("INSERT INTO run_traces(id,job_id,role,prompt_version,provider_config_hash,created_at) VALUES('trace_a','job_a','writer','v1',?,'2026-10-31T00:00:00Z')",(digest,))
db.execute("DELETE FROM tasks WHERE id='task_a'")
for table in ['jobs','evidence','candidate_sets','candidates','decisions','current_decisions','fact_packs','artifacts','artifact_files','exports','run_traces']:
    check(db.execute(f'SELECT COUNT(*) FROM {table}').fetchone()[0] == 0, f'task deletion did not cascade: {table}')
check(db.execute('SELECT created_from_task_id,created_from_decision_id FROM rules').fetchone() == (None,None),'rule provenance not detached on task delete')
check(db.execute('SELECT COUNT(*) FROM source_versions').fetchone()[0] == 1,'unrelated task source removed')
check(not db.execute('PRAGMA foreign_key_check').fetchall(), 'foreign key consistency failure')
checks['sql_reference_tables_created'] = table_count
checks['sql_structural_checks'] = ['foreign_keys','enum','positive_revision','job_revision_nonnull','same_task_source_fk','blob_size','unique_file_path','task_delete_cascade','rule_retention_without_source_links']

report = {
    'schema_version':'documentation_validation.v1',
    'status':'passed' if not errors else 'failed',
    'scope':'Documentation, declared contracts, fixture structure and reference SQLite constraints only.',
    'checks':checks,
    'errors':errors,
    'not_claimed':['Complete JSON Schema engine validation','Application implementation or API integration','Live LLM quality','OS/container isolation','Reproduction target execution','Product security guarantee','User time savings'],
    'product_test_execution_status':'not_run'
}
(ROOT/'validation-report.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(report,ensure_ascii=False,indent=2))
sys.exit(1 if errors else 0)
