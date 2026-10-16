import sys, json, re
for line in open(sys.argv[1], errors='replace'):
    if 'SPIKE|' not in line: 
        if re.search(r'rror|locked|denied|fail', line, re.I): print('!!', line.strip()[:300])
        continue
    s = line.split('SPIKE|',1)[1].strip()
    try:
        j = json.loads(s)
        p = j.get('payload', j)
        t = j.get('type')
        print(f"{t:22} {json.dumps(p, ensure_ascii=False)[:900]}")
    except Exception:
        print('RAW', s[:300])
