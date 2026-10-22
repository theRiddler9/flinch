import { describe, expect, test } from 'bun:test';
import { extractGuide, isShortcut, parseInline, resolveGuide, splitReply } from './guide';

const REPLY = `### 🛠️ Manual Blender Step-by-Step Modeling Guide
1. **Block out the base.** \`Shift + A > Mesh > Cylinder\`, then \`Tab\` for Edit Mode.
   - Set \`Vertices\` to 32 in the Adjust Last Operation panel.
2. **Add loop cuts.** \`Ctrl + R\` and scroll the wheel to add 2 cuts.
3. Bevel the rim: \`Ctrl + B\` with width 0.02.

**Tips for making it your own**
- Try a \`Ctrl + 2\` subdivision preview.
- Swap the base color in the Shader Editor.

### 🐍 Executable Blender Python (bpy) Script
\`\`\`python
import bpy
bpy.ops.mesh.primitive_cylinder_add()
\`\`\`
`;
const HEAD = '### Manual Blender Step-by-Step Modeling Guide\n';
const SCRIPT = '\n### Executable Blender Python (bpy) Script\n```python\nimport bpy\n```';

describe('splitReply', () => {
  test('separates guide from code and drops the script heading', () => {
    const segs = splitReply(REPLY);
    expect(segs.map((s) => s.kind)).toEqual(['guide', 'code']);
    expect(segs[1].kind === 'code' && segs[1].code).toBe('import bpy\nbpy.ops.mesh.primitive_cylinder_add()');
  });

  test('parses steps, nested bullets and tips', () => {
    const g = extractGuide(REPLY);
    expect(g?.steps.map((s) => s.number)).toEqual([1, 2, 3]);
    expect(g?.steps[0].title).toBe('Block out the base');
    expect(g?.steps[0].body.join(' ')).toContain('Shift + A > Mesh > Cylinder');
    expect(g?.steps[0].body.some((l) => l.includes('Vertices'))).toBe(true);
    expect(g?.steps[2].title).toBe('Bevel the rim');
    expect(g?.tipsTitle).toBe('Tips for making it your own');
    expect(g?.tips).toHaveLength(2);
  });

  test('streaming: unclosed code block and partial guide', () => {
    const last = splitReply(REPLY.replace(/```\n$/, '')).at(-1);
    expect(last?.kind === 'code' && last.closed).toBe(false);
    const segs = splitReply(HEAD + '1. **Start.** `A`');
    expect(segs[0].kind === 'guide' && segs[0].guide.steps).toHaveLength(1);
  });

  test('plain replies, heading variants and python fences ending the guide', () => {
    expect(splitReply('Sure.\n```python\nimport bpy\n```').map((s) => s.kind)).toEqual(['text', 'code']);
    expect(splitReply('## Manual Blender Step-by-Step Modeling Guide\n1. Do it.\n\n## Executable Blender Python (bpy) Script\n```python\nimport bpy\n```').map((s) => s.kind)).toEqual(['guide', 'code']);
    expect(splitReply(HEAD + '1. Do it.\n```python\nimport bpy\n```').map((s) => s.kind)).toEqual(['guide', 'code']);
  });

  test('a longer outer fence keeps inner fences as code', () => {
    const segs = splitReply('````python\nimport bpy\ns = """\n```\n"""\n````');
    expect(segs).toHaveLength(1);
    expect(segs[0].kind === 'code' && segs[0].code).toContain('```');
  });
});

describe('guide resolution across attempts', () => {
  const unchanged = HEAD + '_Guide unchanged._\n' + SCRIPT;
  test('"unchanged" falls back to the previous attempt; newest real guide wins', () => {
    expect(extractGuide(unchanged)).toBeNull();
    expect(resolveGuide([REPLY, unchanged], 1)?.steps).toHaveLength(3);
    expect(resolveGuide([REPLY, HEAD + '1. **Only step.** `A`\n' + SCRIPT], 1)?.steps).toHaveLength(1);
    expect(resolveGuide(['```python\nimport bpy\n```'], 0)).toBeNull();
    expect(resolveGuide([], 0)).toBeNull();
  });
});

describe('inline formatting', () => {
  test('recognises shortcuts', () => {
    for (const k of ['Tab', 'Shift + A', 'Ctrl + Shift + C', 'X', 'Numpad 1', 'F12', 'Ctrl + 2']) expect(isShortcut(k)).toBe(true);
    for (const k of ['Subdivision Surface', '0.02', 'Mesh', 'Base Color']) expect(isShortcut(k)).toBe(false);
  });

  test('menu paths, bold, code values and unbalanced backticks', () => {
    const [tok] = parseInline('`Shift + A > Mesh > Cylinder`');
    expect(tok.kind === 'path' && tok.parts).toEqual([
      { kind: 'keys', keys: ['Shift', 'A'] },
      { kind: 'label', value: 'Mesh' },
      { kind: 'label', value: 'Cylinder' },
    ]);
    expect(parseInline('Set **Width** to `0.02` then press `E`.').map((t) => t.kind)).toEqual(['text', 'bold', 'text', 'code', 'text', 'keys', 'text']);
    expect(parseInline('a ` b')).toEqual([{ kind: 'text', value: 'a ` b' }]);
  });
});
