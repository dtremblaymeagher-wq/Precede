/**
 * Tiptap bundle entry point.
 * Exposes globals consumed by shared/tiptap-editor.js
 */
import { Editor, Extension, Node } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Underline from '@tiptap/extension-underline';
import Placeholder from '@tiptap/extension-placeholder';
import Suggestion from '@tiptap/suggestion';
import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';

window.TiptapCore                 = { Editor, Extension, Node };
window.TiptapStarterKit           = { default: StarterKit };
window.TiptapExtensionUnderline   = { default: Underline };
window.TiptapExtensionPlaceholder = { default: Placeholder };
window.TiptapSuggestion           = { default: Suggestion };
window.TiptapExtensionTable       = { Table, TableRow, TableCell, TableHeader };
