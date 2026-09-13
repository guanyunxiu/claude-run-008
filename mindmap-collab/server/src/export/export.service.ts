import { Injectable } from '@nestjs/common';
import * as Y from 'yjs';
import { create } from 'xmlbuilder2';
import type { Root, List, ListItem, RootContent } from 'mdast';
import { DocumentsService } from '../documents/documents.service';
import { CollaborationService } from '../collaboration/collaboration.service';
import { buildTree, readNodes, TreeNode } from '../collaboration/tree.util';

@Injectable()
export class ExportService {
  constructor(
    private documents: DocumentsService,
    private collaboration: CollaborationService,
  ) {}

  private async loadTree(documentId: string, userId: string) {
    const meta = await this.documents.assertAccess(documentId, userId);
    const state = await this.collaboration.getCurrentState(documentId);
    let tree: TreeNode | null = null;
    if (state) {
      const doc = new Y.Doc();
      Y.applyUpdate(doc, new Uint8Array(state));
      tree = buildTree(readNodes(doc));
      doc.destroy();
    }
    // 文档还没有任何协同状态（新建未编辑）→ 导出仅含标题的空骨架，而非 404
    if (!tree) {
      tree = {
        id: 'root',
        parentId: null,
        text: meta.title,
        collapsed: false,
        order: 0,
        children: [],
      };
    }
    return { meta, tree };
  }

  /** Markdown：根节点作为一级标题，子节点为嵌套无序列表（remark 序列化） */
  async toMarkdown(documentId: string, userId: string): Promise<string> {
    const { meta, tree } = await this.loadTree(documentId, userId);
    // remark 是纯 ESM，Nest 编译为 CJS 时不能顶层 require，改动态 import
    const { remark } = await import('remark');

    const toListItem = (node: TreeNode): ListItem => {
      const children: ListItem['children'] = [
        {
          type: 'paragraph',
          children: [{ type: 'text', value: node.text || ' ' }],
        },
      ];
      if (node.children.length) {
        children.push({
          type: 'list',
          ordered: false,
          spread: false,
          children: node.children.map(toListItem),
        } as List);
      }
      return { type: 'listItem', spread: false, children };
    };

    const root: Root = {
      type: 'root',
      children: [
        {
          type: 'heading',
          depth: 1,
          children: [{ type: 'text', value: tree.text || meta.title }],
        },
        {
          type: 'list',
          ordered: false,
          spread: false,
          children: tree.children.map(toListItem),
        } as List,
      ] as RootContent[],
    };

    return remark().stringify(root);
  }

  /** OPML 2.0：outline 嵌套结构（xmlbuilder2 生成） */
  async toOpml(documentId: string, userId: string): Promise<string> {
    const { meta, tree } = await this.loadTree(documentId, userId);

    const doc = create({ version: '1.0', encoding: 'UTF-8' }).ele('opml', {
      version: '2.0',
    });
    const head = doc.ele('head');
    head.ele('title').txt(meta.title).up();
    head.ele('dateCreated').txt(new Date().toUTCString()).up();
    const body = doc.ele('body');

    const appendOutline = (parent: any, node: TreeNode) => {
      const el = parent.ele('outline', { text: node.text || '' });
      node.children.forEach((c) => appendOutline(el, c));
    };
    appendOutline(body, tree);

    return doc.end({ prettyPrint: true });
  }
}
