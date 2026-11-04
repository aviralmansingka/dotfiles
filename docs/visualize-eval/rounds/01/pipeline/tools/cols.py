import sys
lines = [l.rstrip("\n") for l in open(sys.argv[1]) if not l.startswith("#")]
start = int(sys.argv[2]); end = int(sys.argv[3])
for n, l in enumerate(lines, 1):
    if start <= n <= end:
        cells = [(i, c) for i, c in enumerate(l) if c != " "]
        print(n, " ".join("%d:%s" % (i, c) for i, c in cells))
