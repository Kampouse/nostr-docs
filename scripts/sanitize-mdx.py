import os, re, glob

nips_dir = os.path.expanduser("~/dev/nostr-docs/src/content/docs/nips")
files = sorted(glob.glob(os.path.join(nips_dir, "*.mdx")))

fixed_count = 0
changes_log = []

for fpath in files:
    with open(fpath, 'r') as f:
        content = f.read()
    
    original = content
    
    # 1. Replace bare <br> variants with markdown line break
    content = re.sub(r'<br\s*/?>', '  ', content, flags=re.IGNORECASE)
    
    lines = content.split('\n')
    new_lines = []
    in_code_block = False
    
    for line in lines:
        if line.strip().startswith('```'):
            in_code_block = not in_code_block
            new_lines.append(line)
            continue
        
        if in_code_block:
            new_lines.append(line)
            continue
        
        # Skip frontmatter
        if line.strip() == '---' and len(new_lines) < 5:
            # In frontmatter region - pass through
            new_lines.append(line)
            continue
        
        # Split by inline code backticks to protect them
        parts = re.split(r'(`[^`]+`)', line)
        processed_parts = []
        for part in parts:
            if part.startswith('`') and part.endswith('`') and len(part) > 2:
                processed_parts.append(part)
            else:
                # Escape < that are NOT valid HTML/JSX tags
                safe_prefixes = (
                    'a ', '/a>', 'br', 'code', '/code', 'div', '/div', 'em', '/em',
                    'li', '/li', 'ol', '/ol', 'p>', '/p>', 'pre', '/pre',
                    'span', '/span', 'strong', '/strong', 'sub', '/sub', 'sup', '/sup',
                    'table', '/table', 'td', '/td', 'th', '/th', 'tr', '/tr', 'ul', '/ul',
                    'img ', 'hr', '!--',
                )
                
                def escape_lt(m):
                    after = m.group(1)
                    if any(after.startswith(t) for t in safe_prefixes):
                        return '<' + after
                    return '&lt;' + after
                
                part = re.sub(r'<([^/\s!])', escape_lt, part)
                
                def escape_lt_close(m):
                    after = m.group(1)
                    safe_close = [t.lstrip('/') for t in safe_prefixes if t.startswith('/')]
                    if any(after.startswith(t) for t in safe_close):
                        return '</' + after
                    return '&lt;/' + after
                
                part = re.sub(r'</([^/\s!])', escape_lt_close, part)
                
                # Escape { and } that are NOT inside markdown links [text](url{...})
                # MDX treats { } as JSX expressions
                # We need to escape bare { } in prose that look like JSON or template syntax
                # But NOT: frontmatter (already handled), code blocks (already handled)
                # Strategy: replace { with &#123; and } with &#125; 
                # But only when they're not part of a markdown construct
                # Actually safest: replace ALL { and } in non-code prose
                # But that breaks markdown links with { }... which are rare in NIPs
                # Let's check: are there any []() links with {} in the NIPs?
                # Safer approach: only escape { that are followed by space, quote, or digit
                # and } that are preceded by space, quote, or digit
                
                # Replace { that look like JSON/object syntax
                # Match { followed by: space, quote, digit, or another {
                part = re.sub(r'\{(?=[\s"\'\d{])', '&#123;', part)
                # Replace } preceded by: space, quote, digit, or another }
                part = re.sub(r'(?<=[\s"\'\d}])\}', '&#125;', part)
                
                processed_parts.append(part)
        
        new_lines.append(''.join(processed_parts))
    
    content = '\n'.join(new_lines)
    
    if content != original:
        fixed_count += 1
        fname = os.path.basename(fpath)
        # Count what changed
        lt_count = original.count('&lt;') - content.count('&lt;')
        brace_count = original.count('&#123;') - content.count('&#123;')
        changes_log.append(f"  {fname}: escaped < chars and {{ }} braces")

    with open(fpath, 'w') as f:
        f.write(content)

print(f"Fixed {fixed_count} files out of {len(files)} total")
for c in changes_log[:20]:
    print(c)
