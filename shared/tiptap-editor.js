/**
 * RichTextEditor — reusable Tiptap wrapper
 * Depends on shared/tiptap-bundle.js loaded before this file.
 */

(function () {

    function _getTiptap() {
        const core        = window.TiptapCore                 || {};
        const starterKit  = window.TiptapStarterKit           || {};
        const underline   = window.TiptapExtensionUnderline   || {};
        const placeholder = window.TiptapExtensionPlaceholder || {};
        const suggestion  = window.TiptapSuggestion           || {};
        const tableExts   = window.TiptapExtensionTable       || {};

        return {
            Editor:      core.Editor,
            Extension:   core.Extension,
            Node:        core.Node,
            StarterKit:  starterKit.default || starterKit.StarterKit || starterKit,
            Underline:   underline.default  || underline.Underline   || underline,
            Placeholder: placeholder.default || placeholder.Placeholder || placeholder,
            Suggestion:  suggestion.default  || suggestion.Suggestion  || suggestion,
            Table:       tableExts.Table,
            TableRow:    tableExts.TableRow,
            TableCell:   tableExts.TableCell,
            TableHeader: tableExts.TableHeader,
        };
    }

    // ── Panel node extension ─────────────────────────────────────────

    function _buildPanelExtension(tiptap) {
        if (!tiptap.Node) return null;

        const PANEL_STYLES = {
            info:    'background:#eff6ff; border-left:4px solid #3b82f6; color:#1e40af;',
            warning: 'background:#fffbeb; border-left:4px solid #f59e0b; color:#92400e;',
            success: 'background:#f0fdf4; border-left:4px solid #22c55e; color:#166534;',
            error:   'background:#fef2f2; border-left:4px solid #ef4444; color:#991b1b;',
            note:    'background:#faf5ff; border-left:4px solid #8b5cf6; color:#5b21b6;',
        };

        return tiptap.Node.create({
            name:    'panel',
            group:   'block',
            content: 'block+',

            addAttributes() {
                return {
                    type: {
                        default:    'info',
                        parseHTML:  el => el.getAttribute('data-type'),
                        renderHTML: attrs => ({ 'data-type': attrs.type }),
                    },
                };
            },

            parseHTML() {
                return [{ tag: 'div[data-panel]' }];
            },

            renderHTML({ HTMLAttributes }) {
                const type  = HTMLAttributes['data-type'] || 'info';
                const style = `${PANEL_STYLES[type] || PANEL_STYLES.info} padding:10px 14px 10px 44px; border-radius:0 8px 8px 0; margin:8px 0; position:relative;`;
                return ['div', { 'data-panel': '', 'data-type': type, style }, 0];
            },
        });
    }

    // ── Slash-command popup ───────────────────────────────────────────

    function _buildSlashExtension(tiptap) {
        const Suggestion = tiptap.Suggestion;
        const Extension  = tiptap.Extension;

        if (!Suggestion || !Extension) return null;

        const COMMANDS = [
            {
                title: '📋 Info Panel',
                description: 'Blue informational callout',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range)
                        .insertContent({ type: 'panel', attrs: { type: 'info' },    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Info: ' }] }] })
                        .run();
                },
            },
            {
                title: '⚠️ Warning Panel',
                description: 'Yellow warning callout',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range)
                        .insertContent({ type: 'panel', attrs: { type: 'warning' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Warning: ' }] }] })
                        .run();
                },
            },
            {
                title: '✅ Success Panel',
                description: 'Green success callout',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range)
                        .insertContent({ type: 'panel', attrs: { type: 'success' }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Success: ' }] }] })
                        .run();
                },
            },
            {
                title: '❌ Error Panel',
                description: 'Red error or critical callout',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range)
                        .insertContent({ type: 'panel', attrs: { type: 'error' },   content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Error: ' }] }] })
                        .run();
                },
            },
            {
                title: '💡 Note Panel',
                description: 'Purple note or insight callout',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range)
                        .insertContent({ type: 'panel', attrs: { type: 'note' },    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note: ' }] }] })
                        .run();
                },
            },
            {
                title: '📝 Decision',
                description: 'Document a decision with rationale',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range)
                        .insertContent('<p><strong>📝 Decision:</strong> </p><p><strong>Rationale:</strong> </p><p><strong>Alternatives considered:</strong> </p>')
                        .run();
                },
            },
            {
                title: '❝ Quote',
                description: 'Add a user or stakeholder quote',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range)
                        .insertContent('<blockquote><p>"Quote from user or stakeholder"<br><em>— Source, Context</em></p></blockquote>')
                        .run();
                },
            },
            {
                title: '🔲 Given / When / Then',
                description: 'Add a Gherkin acceptance criterion',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range)
                        .insertContent('<p><strong>Given</strong> </p><p><strong>When</strong> </p><p><strong>Then</strong> </p>')
                        .run();
                },
            },
            {
                title: '📊 Table',
                description: 'Add a comparison table',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range)
                        .insertContent('<table><tr><th>Column 1</th><th>Column 2</th><th>Column 3</th></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr><tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr></table>')
                        .run();
                },
            },
            {
                title: '📐 Heading 1',
                description: 'Add a large heading',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range).toggleHeading({ level: 1 }).run();
                },
            },
            {
                title: '📑 Heading 2',
                description: 'Add a medium heading',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range).toggleHeading({ level: 2 }).run();
                },
            },
            {
                title: '• Bullet List',
                description: 'Add a bulleted list',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range).toggleBulletList().run();
                },
            },
            {
                title: '1. Ordered List',
                description: 'Add a numbered list',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range).toggleOrderedList().run();
                },
            },
            {
                title: '</> Code Block',
                description: 'Add a code block',
                command: ({ editor, range }) => {
                    editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
                },
            },
        ];

        return Extension.create({
            name: 'slashCommands',
            addProseMirrorPlugins() {
                return [
                    Suggestion({
                        editor: this.editor,
                        char:   '/',
                        command: ({ editor, range, props }) => {
                            props.command({ editor, range });
                        },
                        items: ({ query }) => COMMANDS.filter(item =>
                            item.title.toLowerCase().includes(query.toLowerCase()) ||
                            item.description.toLowerCase().includes(query.toLowerCase())
                        ),
                        render: () => {
                            let popup = null;
                            let selectedIndex = 0;

                            const removePopup = () => {
                                if (popup) { popup.remove(); popup = null; }
                            };

                            const renderItems = (items) => {
                                if (!popup) return;
                                popup.innerHTML = `
                                    <div style="padding:4px 8px 6px;font-size:10px;font-weight:800;color:#94a3b8;text-transform:uppercase;letter-spacing:0.05em;">
                                        Insert block
                                    </div>
                                    ${items.map((item, index) => `
                                    <div class="slash-item" data-index="${index}"
                                         style="display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;cursor:pointer;transition:background 0.1s;background:${index === selectedIndex ? '#f1f5f9' : 'transparent'}">
                                        <div style="font-size:1.1em;width:24px;text-align:center;">${item.title.split(' ')[0]}</div>
                                        <div>
                                            <div style="font-size:13px;font-weight:600;color:#1e293b;">${item.title.split(' ').slice(1).join(' ')}</div>
                                            <div style="font-size:11px;color:#94a3b8;">${item.description}</div>
                                        </div>
                                    </div>`).join('')}
                                `;

                                popup.querySelectorAll('.slash-item').forEach(el => {
                                    el.addEventListener('mouseenter', () => { el.style.background = '#f1f5f9'; });
                                    el.addEventListener('mouseleave', () => {
                                        if (parseInt(el.dataset.index) !== selectedIndex) el.style.background = 'transparent';
                                    });
                                });
                            };

                            return {
                                onStart: (props) => {
                                    selectedIndex = 0;
                                    popup = document.createElement('div');
                                    popup.style.cssText = [
                                        'position:fixed',
                                        'z-index:9999',
                                        'background:white',
                                        'border:1px solid #e2e8f0',
                                        'border-radius:12px',
                                        'box-shadow:0 8px 32px rgba(0,0,0,0.12)',
                                        'padding:6px',
                                        'min-width:280px',
                                        'max-height:320px',
                                        'overflow-y:auto',
                                    ].join(';');

                                    const rect = props.clientRect();
                                    popup.style.top  = `${rect.bottom + 8}px`;
                                    popup.style.left = `${rect.left}px`;

                                    renderItems(props.items);
                                    document.body.appendChild(popup);

                                    popup.addEventListener('mousedown', (e) => {
                                        const item = e.target.closest('.slash-item');
                                        if (item) {
                                            e.preventDefault();
                                            props.items[parseInt(item.dataset.index)]
                                                .command({ editor: props.editor, range: props.range });
                                            removePopup();
                                        }
                                    });
                                },
                                onUpdate: (props) => {
                                    selectedIndex = 0;
                                    if (popup) {
                                        const rect = props.clientRect();
                                        popup.style.top  = `${rect.bottom + 8}px`;
                                        popup.style.left = `${rect.left}px`;
                                        renderItems(props.items);
                                    }
                                },
                                onKeyDown: (props) => {
                                    if (!popup) return false;
                                    const items = popup.querySelectorAll('.slash-item');
                                    if (props.event.key === 'ArrowDown') {
                                        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
                                        renderItems(props.items);
                                        return true;
                                    }
                                    if (props.event.key === 'ArrowUp') {
                                        selectedIndex = Math.max(selectedIndex - 1, 0);
                                        renderItems(props.items);
                                        return true;
                                    }
                                    if (props.event.key === 'Enter') {
                                        if (props.items[selectedIndex]) {
                                            props.items[selectedIndex].command({ editor: props.editor, range: props.range });
                                        }
                                        removePopup();
                                        return true;
                                    }
                                    if (props.event.key === 'Escape') {
                                        removePopup();
                                        return true;
                                    }
                                    return false;
                                },
                                onExit: () => {
                                    removePopup();
                                },
                            };
                        },
                    }),
                ];
            },
        });
    }

    // ── RichTextEditor class ──────────────────────────────────────────

    class RichTextEditor {
        constructor(element, options = {}) {
            this.onChange         = options.onChange || (() => {});
            this._originalElement = element;

            const tiptap = _getTiptap();
            if (!tiptap.Editor) {
                console.error('RichTextEditor: Tiptap core not found on window. Check tiptap-bundle.js.');
                return;
            }

            // ── Wrapper ──────────────────────────────────────────────
            this.container = document.createElement('div');
            this.container.style.cssText = [
                'border:1.5px solid #e2e8f0',
                'border-radius:10px',
                'overflow:hidden',
                'background:white',
                'transition:border-color 0.15s',
            ].join(';');

            this.container.addEventListener('focusin',  () => { this.container.style.borderColor = '#6366f1'; });
            this.container.addEventListener('focusout', () => { this.container.style.borderColor = '#e2e8f0'; });

            // ── Toolbar ───────────────────────────────────────────────
            this._toolbar = this._createToolbar();
            this.container.appendChild(this._toolbar);

            // ── Editor div ────────────────────────────────────────────
            this.editorDiv = document.createElement('div');
            this.editorDiv.style.cssText = [
                'padding:10px 14px',
                `min-height:${options.minHeight || '120px'}`,
                'outline:none',
                'font-size:14px',
                'line-height:1.6',
                'color:#1e293b',
            ].join(';');
            this.container.appendChild(this.editorDiv);

            // ── Mount in DOM ──────────────────────────────────────────
            element.parentNode.insertBefore(this.container, element);
            element.style.display = 'none';

            // ── Extensions ────────────────────────────────────────────
            const extensions = [tiptap.StarterKit];

            if (tiptap.Placeholder && tiptap.Placeholder.configure) {
                extensions.push(tiptap.Placeholder.configure({
                    placeholder: options.placeholder || 'Start typing…',
                }));
            }
            if (tiptap.Table && tiptap.TableRow && tiptap.TableCell && tiptap.TableHeader) {
                extensions.push(tiptap.Table.configure({ resizable: true }));
                extensions.push(tiptap.TableRow);
                extensions.push(tiptap.TableCell);
                extensions.push(tiptap.TableHeader);
            }

            const panelExt = _buildPanelExtension(tiptap);
            if (panelExt) extensions.push(panelExt);

            const slashExt = _buildSlashExtension(tiptap);
            if (slashExt) extensions.push(slashExt);

            // ── Initialize Tiptap ─────────────────────────────────────
            this.editor = new tiptap.Editor({
                element:    this.editorDiv,
                extensions,
                content:    element.value || '',
                onUpdate:   ({ editor }) => {
                    element.value = editor.getHTML();
                    this.onChange(editor.getHTML());
                    this._refreshToolbar();
                },
                onSelectionUpdate: () => {
                    this._refreshToolbar();
                },
            });
        }

        // ── Toolbar ────────────────────────────────────────────────────

        _createToolbar() {
            const toolbar = document.createElement('div');
            toolbar.style.cssText = [
                'display:flex',
                'gap:2px',
                'padding:6px 10px',
                'border-bottom:1px solid #e2e8f0',
                'background:#f8fafc',
                'flex-wrap:wrap',
                'align-items:center',
            ].join(';');

            this._toolbarButtons = [];

            const buttons = [
                { label: '<b>B</b>',   title: 'Bold',          key: 'bold',        action: () => this.editor.chain().focus().toggleBold().run(),                isActive: () => this.editor.isActive('bold') },
                { label: '<i>I</i>',   title: 'Italic',        key: 'italic',      action: () => this.editor.chain().focus().toggleItalic().run(),              isActive: () => this.editor.isActive('italic') },
                { label: '<u>U</u>',   title: 'Underline',     key: 'underline',   action: () => this.editor.chain().focus().toggleUnderline().run(),           isActive: () => this.editor.isActive('underline') },
                { label: '<s>S</s>',   title: 'Strikethrough', key: 'strike',      action: () => this.editor.chain().focus().toggleStrike().run(),              isActive: () => this.editor.isActive('strike') },
                { divider: true },
                { label: 'H1',         title: 'Heading 1',     key: 'h1',          action: () => this.editor.chain().focus().toggleHeading({ level: 1 }).run(), isActive: () => this.editor.isActive('heading', { level: 1 }) },
                { label: 'H2',         title: 'Heading 2',     key: 'h2',          action: () => this.editor.chain().focus().toggleHeading({ level: 2 }).run(), isActive: () => this.editor.isActive('heading', { level: 2 }) },
                { label: 'H3',         title: 'Heading 3',     key: 'h3',          action: () => this.editor.chain().focus().toggleHeading({ level: 3 }).run(), isActive: () => this.editor.isActive('heading', { level: 3 }) },
                { divider: true },
                { label: '•',          title: 'Bullet list',   key: 'bulletList',  action: () => this.editor.chain().focus().toggleBulletList().run(),          isActive: () => this.editor.isActive('bulletList') },
                { label: '1.',         title: 'Ordered list',  key: 'orderedList', action: () => this.editor.chain().focus().toggleOrderedList().run(),         isActive: () => this.editor.isActive('orderedList') },
                { label: '❝',          title: 'Blockquote',    key: 'blockquote',  action: () => this.editor.chain().focus().toggleBlockquote().run(),          isActive: () => this.editor.isActive('blockquote') },
                { label: '&lt;/&gt;', title: 'Code block',    key: 'codeBlock',   action: () => this.editor.chain().focus().toggleCodeBlock().run(),           isActive: () => this.editor.isActive('codeBlock') },
                { divider: true },
                { label: '↩',          title: 'Undo',          key: 'undo',        action: () => this.editor.chain().focus().undo().run(),                      isActive: () => false },
                { label: '↪',          title: 'Redo',          key: 'redo',        action: () => this.editor.chain().focus().redo().run(),                      isActive: () => false },
            ];

            buttons.forEach(btn => {
                if (btn.divider) {
                    const sep = document.createElement('span');
                    sep.style.cssText = 'width:1px;height:16px;background:#e2e8f0;margin:0 4px;display:inline-block;vertical-align:middle;';
                    toolbar.appendChild(sep);
                    return;
                }

                const button = document.createElement('button');
                button.innerHTML   = btn.label;
                button.title       = btn.title;
                button.type        = 'button';
                button.dataset.key = btn.key;
                button.style.cssText = [
                    'padding:3px 7px',
                    'border:1px solid transparent',
                    'border-radius:5px',
                    'cursor:pointer',
                    'font-size:12px',
                    'font-weight:bold',
                    'background:transparent',
                    'color:#475569',
                    'line-height:1.4',
                    'transition:all 0.1s',
                    'user-select:none',
                ].join(';');

                button.addEventListener('mouseenter', () => {
                    if (!btn.isActive()) button.style.background = '#e2e8f0';
                });
                button.addEventListener('mouseleave', () => {
                    this._applyActiveStyle(button, btn.isActive());
                });
                button.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    btn.action();
                });

                toolbar.appendChild(button);
                this._toolbarButtons.push({ el: button, isActive: btn.isActive.bind(this) });
            });

            return toolbar;
        }

        _refreshToolbar() {
            if (!this._toolbarButtons) return;
            this._toolbarButtons.forEach(({ el, isActive }) => {
                this._applyActiveStyle(el, isActive());
            });
        }

        _applyActiveStyle(button, active) {
            if (active) {
                button.style.background  = '#6366f1';
                button.style.color       = 'white';
                button.style.borderColor = '#6366f1';
            } else {
                button.style.background  = 'transparent';
                button.style.color       = '#475569';
                button.style.borderColor = 'transparent';
            }
        }

        // ── Public API ─────────────────────────────────────────────────

        getHTML() {
            return this.editor ? this.editor.getHTML() : '';
        }

        getText() {
            return this.editor ? this.editor.getText() : '';
        }

        setContent(html) {
            if (this.editor) {
                this.editor.commands.setContent(html || '');
                this._originalElement.value = html || '';
            }
        }

        clear() {
            if (this.editor) this.editor.commands.clearContent();
        }

        focus() {
            if (this.editor) this.editor.commands.focus();
        }

        destroy() {
            if (this.editor) {
                this.editor.destroy();
                this.editor = null;
            }
            if (this.container && this.container.parentNode) {
                this.container.parentNode.removeChild(this.container);
            }
            if (this._originalElement) {
                this._originalElement.style.display = '';
            }
        }
    }

    window.RichTextEditor = RichTextEditor;

}());
