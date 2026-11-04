import re, sys
path = sys.argv[1]
t = open(path, encoding="utf-8", errors="ignore").read()
texts = [x for x in re.findall(r'text="([^"]*)"', t) if x]
print("\n".join(texts[:80]))
