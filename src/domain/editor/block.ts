/**
 * Блоки документа из EditorContent.blocks. Смещения сервер считает в кодовых точках
 * Unicode по plain_text; совпадение типов с контрактом проверяется в src/api/types.ts.
 */

export const DOCUMENT_BLOCK_TYPES = [
  'heading',
  'paragraph',
  'list_item',
  'code',
  'table',
  'other',
] as const;
export type DocumentBlockType = (typeof DOCUMENT_BLOCK_TYPES)[number];

export interface DocumentBlock {
  ref: string;
  type: DocumentBlockType;
  start_offset: number;
  end_offset: number;
  editable: boolean;
}
