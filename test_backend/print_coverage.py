import os

def parse_lcov_info(info_filepath):
    coverage = {}
    if not os.path.exists(info_filepath):
        return coverage
    with open(info_filepath, 'r', encoding='utf-8') as f:
        current_sf = None
        lf = 0
        lh = 0
        fnf = 0
        fnh = 0
        uncovered = []
        for line in f:
            line = line.strip()
            if line.startswith('SF:'):
                current_sf = line[3:].replace('\\', '/')
                lf, lh, fnf, fnh = 0, 0, 0, 0
                uncovered = []
            elif line.startswith('DA:'):
                parts = line[3:].split(',')
                if len(parts) >= 2:
                    line_num = int(parts[0])
                    hits = int(parts[1])
                    if hits == 0:
                        uncovered.append(line_num)
            elif line.startswith('LF:'):
                lf = int(line[3:])
            elif line.startswith('LH:'):
                lh = int(line[3:])
            elif line.startswith('FNF:'):
                fnf = int(line[4:])
            elif line.startswith('FNH:'):
                fnh = int(line[4:])
            elif line == 'end_of_record':
                if current_sf:
                    coverage[current_sf] = {
                        'lines_found': lf,
                        'lines_hit': lh,
                        'functions_found': fnf,
                        'functions_hit': fnh,
                        'uncovered_lines': sorted(uncovered)
                    }
                    current_sf = None
    return coverage

def format_line_ranges(lines):
    if not lines:
        return "None"
    ranges = []
    start = lines[0]
    prev = lines[0]
    for n in lines[1:]:
        if n == prev + 1:
            prev = n
        else:
            if start == prev:
                ranges.append(str(start))
            else:
                ranges.append(f"{start}-{prev}")
            start = n
            prev = n
    if start == prev:
        ranges.append(str(start))
    else:
        ranges.append(f"{start}-{prev}")
    return ", ".join(ranges)

info_path = 'build_wsl/coverage.info'
cov = parse_lcov_info(info_path)
print(f"{'File':<35} | {'Line Cov':<8} | {'Lines (Hit/Total)':<18} | {'Uncovered Ranges'}")
print("-" * 120)
for k, v in sorted(cov.items()):
    lf = v['lines_found']
    lh = v['lines_hit']
    line_pct = lh/lf*100 if lf > 0 else 100
    if 'TihanFlyCC-main' in k and line_pct < 80:
        rel = k.split('TihanFlyCC-main/')[-1]
        line_pct_str = f"{line_pct:.1f}%"
        ranges = format_line_ranges(v['uncovered_lines'])
        print(f"{rel:<35} | {line_pct_str:<8} | {lh}/{lf:<17} | {ranges}")
