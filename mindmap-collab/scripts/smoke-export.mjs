// 服务端导出逻辑冒烟测试：构造 Y.Doc → buildTree → remark Markdown / xmlbuilder2 OPML
import * as Y from 'yjs';
import { remark } from 'remark';
import { create } from 'xmlbuilder2';
import { buildTree, readNodes, ROOT_ID } from '../server/src/collaboration/tree.util.ts';

// 构造一棵测试树
const doc = new Y.Doc();
const nodes = doc.getMap('nodes');
const mk = (id, parentId, text, order) => {
  const m = new Y.Map();
  m.set('parentId', parentId);
  m.set('text', text);
  m.set('collapsed', false);
  m.set('order', order);
  nodes.set(id, m);
};
mk(ROOT_ID, null, '产品规划', 0);
mk('a', ROOT_ID, '目标', 0);
mk('b', ROOT_ID, ' roadmap', 1);
mk('a1', 'a', 'Q1 增长 20%', 0);
mk('a2', 'a', '留存提升', 1);

const tree = buildTree(readNodes(doc));
if (!tree || tree.children.length !== 2) {
  console.error('✗ buildTree 结构错误');
  process.exit(1);
}
console.log('✓ buildTree 结构正确');

// Markdown（与 ExportService.toMarkdown 相同逻辑）
const toListItem = (node) => {
  const children = [
    { type: 'paragraph', children: [{ type: 'text', value: node.text || ' ' }] },
  ];
  if (node.children.length) {
    children.push({
      type: 'list',
      ordered: false,
      spread: false,
      children: node.children.map(toListItem),
    });
  }
  return { type: 'listItem', spread: false, children };
};
const md = remark().stringify({
  type: 'root',
  children: [
    { type: 'heading', depth: 1, children: [{ type: 'text', value: tree.text }] },
    { type: 'list', ordered: false, spread: false, children: tree.children.map(toListItem) },
  ],
});
console.log('--- Markdown ---');
console.log(md);
if (!md.includes('# 产品规划') || !md.includes('* Q1 增长 20%') || !md.includes('* 目标')) {
  console.error('✗ Markdown 内容不符合预期');
  process.exit(1);
}
console.log('✓ Markdown 导出正确');

// OPML（与 ExportService.toOpml 相同逻辑）
const opml = create({ version: '1.0', encoding: 'UTF-8' }).ele('opml', { version: '2.0' });
opml.ele('head').ele('title').txt('产品规划');
const body = opml.ele('body');
const append = (parent, node) => {
  const el = parent.ele('outline', { text: node.text || '' });
  node.children.forEach((c) => append(el, c));
};
append(body, tree);
const xml = opml.end({ prettyPrint: true });
console.log('--- OPML ---');
console.log(xml);
if (!xml.includes('<opml version="2.0">') || !xml.includes('text="Q1 增长 20%"')) {
  console.error('✗ OPML 内容不符合预期');
  process.exit(1);
}
console.log('✓ OPML 导出正确');
console.log('\n导出测试全部通过 ✅');
