// System prompt pour processus guidé
const SYSTEM_PROMPT = `You guide users through creating a Product Vision Board using Roman Pichler's strict methodology. Section-by-section approach with quality checks.

## PROCESS

**Step 0 - Framing (3 questions):**
1. Your product in 1-2 sentences?
2. For whom?
3. What problem does it solve?

Then proceed through sections 1-5 in order. For each section:
- Present criteria
- Generate 3 options (A, B, C)
- User chooses/customizes
- Auto-check against criteria
- Validate coherence with previous sections
- Move to next

## SECTION 1: VISION
**Criteria:** Inspiring | Shared | Ethical | Concise (1-2 sentences) | Ambitious (BHAG) | Durable (5-10 years) | Solution-free

**Format:** Action verb + ultimate benefit. NO tactics/metrics/solution.

**Good:** "Help people eat healthily" | "1000 songs in your pocket"
**Bad:** "Via AI tools" | "Manage 3-4 mandates" | Too long

**Generate:** A: Short slogan | B: Benefit statement | C: Bold BHAG

## SECTION 2: TARGET GROUP
**Criteria:** Clear | Specific (who's IN/OUT) | Cohesive (similar attributes)

**Format:** Demographics + Behavior + Context + Technology (1-3 sentences)

## SECTION 3: NEEDS
**Criteria:** User-centric | Validatable | Focused (ONE main need) | Outcome-based

**Format:** "Help me [specific outcome]" - Focus on OBSERVABLE RESULT, not solution or emotion.

**CRITICAL:** Avoid emotional states. Focus on measurable outcomes.

## SECTION 4: PRODUCT
**Criteria:** Focused (max 5, ideal 3) | High-level | Coarse-grained | Differentiating

**Format:** List 3-5 capabilities, "feature" level, durable 1-2 years.

## SECTION 5: BUSINESS GOALS
**Criteria:** Results-oriented | Specific targets | Prioritized | Measurable | **Timeframes (CRITICAL)**

**Format:** 2-3 objectives with metrics + explicit timeframes, ranked.

**CRITICAL:** ALL goals must have explicit timeframes.

## STYLE
Direct, efficient, no compromise on Pichler criteria. Signal violations immediately. Guide step by step - present one section at a time and wait for user response before proceeding.

IMPORTANT: After each user response, acknowledge it and move to the NEXT section. Continue until all 5 sections are complete. At the end, present the complete Vision Board summary.`;

// Conversation history
let conversationHistory = [];

// Initialize
document.addEventListener('DOMContentLoaded', async function() {
    const ok = await Auth.requireAuth();
    if (!ok) return;

    // Show return-to-settings banner if launched from Settings
    if (localStorage.getItem('visionBoardReturnToSettings') === 'true') {
        const banner = document.createElement('div');
        banner.style.cssText = `background:#f5f3ff; border:1px solid #c4b5fd;
                    padding:12px 20px; border-radius:10px;
                    margin-bottom:20px; display:flex;
                    align-items:center; justify-content:space-between;`;
        banner.innerHTML = `
            <span style="font-size:0.9em; color:#5b21b6; font-weight:bold;">
                ✨ Vision Board launched from Settings
            </span>
            <button onclick="saveVisionToSettings()"
                    style="background:#6366f1; color:white; border:none;
                           padding:8px 16px; border-radius:8px;
                           font-weight:bold; cursor:pointer; font-size:0.85em;">
                ← Save this vision to Settings
            </button>`;
        const container = document.querySelector('.container');
        container.insertBefore(banner, container.firstChild);
    }

    document.getElementById('userInput').focus();
    
    document.getElementById('userInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });
});

async function sendMessage() {
    const input = document.getElementById('userInput');
    const message = input.value.trim();
    
    if (!message) return;
    
    input.disabled = true;
    document.getElementById('sendBtn').disabled = true;
    
    addMessage(message, 'user');
    input.value = '';
    
    conversationHistory.push({
        role: 'user',
        content: message
    });
    
    showLoading();
    
    try {
        const response = await Auth.fetch('/api/generate', {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-3-5-haiku-20241022',
                max_tokens: 4000,
                system: SYSTEM_PROMPT,
                messages: conversationHistory
            })
        });
        
        if (!response.ok) {
            throw new Error(`API Error: ${response.status}`);
        }
        
        const data = await response.json();
        const assistantMessage = data.content[0].text;
        
        conversationHistory.push({
            role: 'assistant',
            content: assistantMessage
        });
        
        removeLoading();
        addMessage(assistantMessage, 'bot');
        
        const lowerMessage = assistantMessage.toLowerCase();
        const completionIndicators = [
            'complete vision board',
            'final vision board',
            'vision board summary',
            'all sections complete',
            'business goals',
            'would you like me to refine',
            'shall we review',
            'any section',
            'elaborate on any section'
        ];
        
        const isComplete = completionIndicators.some(indicator => 
            lowerMessage.includes(indicator)
        );
        
        const hasAllSections = 
            lowerMessage.includes('vision') &&
            lowerMessage.includes('target') &&
            lowerMessage.includes('needs') &&
            lowerMessage.includes('product') &&
            lowerMessage.includes('business goals');
        
        if (isComplete || hasAllSections) {
            showActions();
        }
        
    } catch (error) {
        console.error('Error:', error);
        removeLoading();
        addMessage('Sorry, there was an error processing your request. Please try again.', 'bot');
    } finally {
        input.disabled = false;
        document.getElementById('sendBtn').disabled = false;
        input.focus();
    }
}

function addMessage(content, type) {
    const chatContainer = document.getElementById('chatContainer');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}-message`;
    
    const avatar = document.createElement('div');
    avatar.className = 'message-avatar';
    avatar.textContent = type === 'bot' ? '🤖' : '💬';
    
    const contentDiv = document.createElement('div');
    contentDiv.className = 'message-content';
    
    const formattedContent = formatMessage(content);
    contentDiv.innerHTML = formattedContent;
    
    messageDiv.appendChild(avatar);
    messageDiv.appendChild(contentDiv);
    
    chatContainer.appendChild(messageDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function formatMessage(text) {
    let formatted = text;
    
    // Section headers (SECTION 1: VISION, etc.)
    formatted = formatted.replace(/SECTION (\d+): ([A-Z\s]+)/g, 
        '<h3 class="section-header"><span class="vision-icon">📋</span>SECTION $1: $2</h3>');
    
    // Step headers
    formatted = formatted.replace(/\*\*Step (\d+)[:\s-]+([^*]+)\*\*/g, 
        '<h3 class="section-header"><span class="vision-icon">📍</span>Step $1: $2</h3>');
    
    // Options A/B/C
    formatted = formatted.replace(/^([ABC]):\s/gm, '<span class="option-label">$1</span> ');
    
    // Bold text
    formatted = formatted.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
    
    // Numbered lists with styled numbers
    formatted = formatted.replace(/^(\d+)\.\s/gm, '<span class="list-number">$1</span> ');
    
    // Bullet points
    formatted = formatted.replace(/^[-•]\s/gm, '<span class="bullet">•</span> ');
    
    // Criteria keywords highlighting
    formatted = formatted.replace(/(Inspiring|Shared|Ethical|Concise|Ambitious|Durable|Solution-free)/g, 
        '<span class="badge badge-section">$1</span>');
    
    formatted = formatted.replace(/(Clear|Specific|Cohesive|User-centric|Validatable|Focused|Outcome-based)/g, 
        '<span class="badge badge-section">$1</span>');
    
    // Line breaks
    formatted = formatted.replace(/\n/g, '<br>');
    
    return formatted;
}

function showLoading() {
    const chatContainer = document.getElementById('chatContainer');
    
    const loadingDiv = document.createElement('div');
    loadingDiv.className = 'message bot-message';
    loadingDiv.id = 'loadingMessage';
    
    loadingDiv.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content loading-message">
            <span>Thinking</span>
            <div class="loading-dots">
                <span></span>
                <span></span>
                <span></span>
            </div>
        </div>
    `;
    
    chatContainer.appendChild(loadingDiv);
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

function removeLoading() {
    const loadingMessage = document.getElementById('loadingMessage');
    if (loadingMessage) {
        loadingMessage.remove();
    }
}

function showActions() {
    document.getElementById('actionsContainer').style.display = 'flex';
}

async function downloadWord() {
    const visionBoardText = conversationHistory
        .filter(msg => msg.role === 'assistant')
        .map(msg => msg.content)
        .join('\n\n');
    
    const sections = parseVisionBoard(visionBoardText);
    
    const primaryColor = "667eea";
    const secondaryColor = "764ba2";
    
    const doc = new docx.Document({
        sections: [{
            properties: {
                page: {
                    margin: {
                        top: 1440,
                        right: 1440,
                        bottom: 1440,
                        left: 1440
                    }
                }
            },
            children: [
                new docx.Paragraph({
                    text: "PRODUCT VISION BOARD",
                    heading: docx.HeadingLevel.TITLE,
                    alignment: docx.AlignmentType.CENTER,
                    spacing: { after: 200 }
                }),
                
                new docx.Paragraph({
                    text: "Roman Pichler Methodology",
                    alignment: docx.AlignmentType.CENTER,
                    spacing: { after: 100 },
                    italics: true
                }),
                
                new docx.Paragraph({
                    text: `Generated: ${new Date().toLocaleDateString('en-US', { 
                        weekday: 'long', 
                        year: 'numeric', 
                        month: 'long', 
                        day: 'numeric' 
                    })}`,
                    alignment: docx.AlignmentType.CENTER,
                    spacing: { after: 400 }
                }),
                
                createVisionBoardTable(sections),
                
                new docx.Paragraph({
                    text: "",
                    spacing: { before: 600, after: 400 }
                }),
                
                new docx.Paragraph({
                    text: "DETAILED BREAKDOWN",
                    heading: docx.HeadingLevel.HEADING_1,
                    spacing: { before: 400, after: 300 }
                }),
                
                ...createDetailedSections(sections),
                
                new docx.Paragraph({
                    text: "",
                    spacing: { before: 800 }
                }),
                
                new docx.Paragraph({
                    text: "Generated by Vision Board Generator",
                    alignment: docx.AlignmentType.CENTER,
                    italics: true
                }),
                
                new docx.Paragraph({
                    text: "Built by David Tremblay Meagher",
                    alignment: docx.AlignmentType.CENTER,
                    italics: true
                })
            ]
        }]
    });
    
    const blob = await docx.Packer.toBlob(doc);
    saveAs(blob, `Vision-Board-${new Date().toISOString().split('T')[0]}.docx`);
}

function parseVisionBoard(text) {
    const sections = {
        vision: '',
        targetGroup: '',
        needs: '',
        product: '',
        businessGoals: '',
        full: text
    };
    
    const visionMatch = text.match(/VISION[:\s]+([\s\S]*?)(?=TARGET GROUP|NEEDS|PRODUCT|$)/i);
    const targetMatch = text.match(/TARGET GROUP[:\s]+([\s\S]*?)(?=NEEDS|PRODUCT|$)/i);
    const needsMatch = text.match(/NEEDS[:\s]+([\s\S]*?)(?=PRODUCT|BUSINESS GOALS|$)/i);
    const productMatch = text.match(/PRODUCT[:\s]+([\s\S]*?)(?=BUSINESS GOALS|$)/i);
    const goalsMatch = text.match(/BUSINESS GOALS[:\s]+([\s\S]*?)$/i);
    
    if (visionMatch) sections.vision = visionMatch[1].trim();
    if (targetMatch) sections.targetGroup = targetMatch[1].trim();
    if (needsMatch) sections.needs = needsMatch[1].trim();
    if (productMatch) sections.product = productMatch[1].trim();
    if (goalsMatch) sections.businessGoals = goalsMatch[1].trim();
    
    return sections;
}

function createVisionBoardTable(sections) {
    const primaryColor = "667eea";
    const secondaryColor = "764ba2";
    
    const vision = cleanText(sections.vision) || "To be defined";
    const target = cleanText(sections.targetGroup) || "To be defined";
    const needs = cleanText(sections.needs) || "To be defined";
    const product = cleanText(sections.product) || "To be defined";
    const goals = cleanText(sections.businessGoals) || "To be defined";
    
    const createCellParagraph = (text, options = {}) => {
        return new docx.Paragraph({
            children: [
                new docx.TextRun({
                    text: text,
                    bold: options.bold || false,
                    color: options.color || "000000",
                    size: options.size || 22
                })
            ],
            alignment: options.alignment || docx.AlignmentType.LEFT,
            spacing: { 
                before: options.spaceBefore || 100, 
                after: options.spaceAfter || 100 
            }
        });
    };
    
    const table = new docx.Table({
        width: {
            size: 100,
            type: docx.WidthType.PERCENTAGE
        },
        columnWidths: [5000, 5000],
        rows: [
            new docx.TableRow({
                height: { value: 600, rule: docx.HeightRule.ATLEAST },
                children: [
                    new docx.TableCell({
                        children: [
                            createCellParagraph("VISION", {
                                bold: true,
                                color: "FFFFFF",
                                size: 28,
                                alignment: docx.AlignmentType.CENTER,
                                spaceBefore: 150,
                                spaceAfter: 150
                            })
                        ],
                        shading: { fill: primaryColor },
                        columnSpan: 2,
                        verticalAlign: docx.VerticalAlign.CENTER,
                        margins: {
                            top: 150,
                            bottom: 150,
                            left: 150,
                            right: 150
                        }
                    })
                ]
            }),
            
            new docx.TableRow({
                height: { value: 1200, rule: docx.HeightRule.ATLEAST },
                children: [
                    new docx.TableCell({
                        children: splitTextIntoParagraphs(vision),
                        columnSpan: 2,
                        margins: {
                            top: 300,
                            bottom: 300,
                            left: 300,
                            right: 300
                        },
                        shading: { fill: "F8F9FA" }
                    })
                ]
            }),
            
            new docx.TableRow({
                height: { value: 600, rule: docx.HeightRule.ATLEAST },
                children: [
                    new docx.TableCell({
                        children: [
                            createCellParagraph("TARGET GROUP", {
                                bold: true,
                                color: "FFFFFF",
                                size: 26,
                                alignment: docx.AlignmentType.CENTER,
                                spaceBefore: 150,
                                spaceAfter: 150
                            })
                        ],
                        shading: { fill: secondaryColor },
                        verticalAlign: docx.VerticalAlign.CENTER,
                        margins: {
                            top: 150,
                            bottom: 150,
                            left: 150,
                            right: 150
                        }
                    }),
                    new docx.TableCell({
                        children: [
                            createCellParagraph("NEEDS", {
                                bold: true,
                                color: "FFFFFF",
                                size: 26,
                                alignment: docx.AlignmentType.CENTER,
                                spaceBefore: 150,
                                spaceAfter: 150
                            })
                        ],
                        shading: { fill: secondaryColor },
                        verticalAlign: docx.VerticalAlign.CENTER,
                        margins: {
                            top: 150,
                            bottom: 150,
                            left: 150,
                            right: 150
                        }
                    })
                ]
            }),
            
            new docx.TableRow({
                height: { value: 1500, rule: docx.HeightRule.ATLEAST },
                children: [
                    new docx.TableCell({
                        children: splitTextIntoParagraphs(target),
                        margins: {
                            top: 300,
                            bottom: 300,
                            left: 300,
                            right: 300
                        },
                        shading: { fill: "FFFFFF" }
                    }),
                    new docx.TableCell({
                        children: splitTextIntoParagraphs(needs),
                        margins: {
                            top: 300,
                            bottom: 300,
                            left: 300,
                            right: 300
                        },
                        shading: { fill: "FFFFFF" }
                    })
                ]
            }),
            
            new docx.TableRow({
                height: { value: 600, rule: docx.HeightRule.ATLEAST },
                children: [
                    new docx.TableCell({
                        children: [
                            createCellParagraph("PRODUCT", {
                                bold: true,
                                color: "FFFFFF",
                                size: 28,
                                alignment: docx.AlignmentType.CENTER,
                                spaceBefore: 150,
                                spaceAfter: 150
                            })
                        ],
                        shading: { fill: primaryColor },
                        columnSpan: 2,
                        verticalAlign: docx.VerticalAlign.CENTER,
                        margins: {
                            top: 150,
                            bottom: 150,
                            left: 150,
                            right: 150
                        }
                    })
                ]
            }),
            
            new docx.TableRow({
                height: { value: 1500, rule: docx.HeightRule.ATLEAST },
                children: [
                    new docx.TableCell({
                        children: splitTextIntoParagraphs(product),
                        columnSpan: 2,
                        margins: {
                            top: 300,
                            bottom: 300,
                            left: 300,
                            right: 300
                        },
                        shading: { fill: "F8F9FA" }
                    })
                ]
            }),
            
            new docx.TableRow({
                height: { value: 600, rule: docx.HeightRule.ATLEAST },
                children: [
                    new docx.TableCell({
                        children: [
                            createCellParagraph("BUSINESS GOALS", {
                                bold: true,
                                color: "FFFFFF",
                                size: 28,
                                alignment: docx.AlignmentType.CENTER,
                                spaceBefore: 150,
                                spaceAfter: 150
                            })
                        ],
                        shading: { fill: secondaryColor },
                        columnSpan: 2,
                        verticalAlign: docx.VerticalAlign.CENTER,
                        margins: {
                            top: 150,
                            bottom: 150,
                            left: 150,
                            right: 150
                        }
                    })
                ]
            }),
            
            new docx.TableRow({
                height: { value: 1500, rule: docx.HeightRule.ATLEAST },
                children: [
                    new docx.TableCell({
                        children: splitTextIntoParagraphs(goals),
                        columnSpan: 2,
                        margins: {
                            top: 300,
                            bottom: 300,
                            left: 300,
                            right: 300
                        },
                        shading: { fill: "FFFFFF" }
                    })
                ]
            })
        ]
    });
    
    return table;
}

function splitTextIntoParagraphs(text) {
    if (!text || text === "To be defined") {
        return [
            new docx.Paragraph({
                children: [
                    new docx.TextRun({
                        text: text || "To be defined",
                        italics: true,
                        color: "999999"
                    })
                ]
            })
        ];
    }
    
    const lines = text.split(/\n+/).filter(line => line.trim());
    
    if (lines.length === 0) {
        lines.push(text);
    }
    
    return lines.map(line => 
        new docx.Paragraph({
            children: [
                new docx.TextRun({
                    text: line.trim(),
                    size: 22
                })
            ],
            spacing: { after: 150 }
        })
    );
}

function createDetailedSections(sections) {
    const children = [];
    const primaryColor = "667eea";
    
    const sectionData = [
        { title: "1. VISION", content: sections.vision, icon: "🎯" },
        { title: "2. TARGET GROUP", content: sections.targetGroup, icon: "👥" },
        { title: "3. NEEDS", content: sections.needs, icon: "💡" },
        { title: "4. PRODUCT", content: sections.product, icon: "📦" },
        { title: "5. BUSINESS GOALS", content: sections.businessGoals, icon: "📈" }
    ];
    
    sectionData.forEach((section, index) => {
        if (section.content) {
            children.push(
                new docx.Paragraph({
                    children: [
                        new docx.TextRun({
                            text: `${section.icon} ${section.title}`,
                            bold: true,
                            size: 28,
                            color: primaryColor
                        })
                    ],
                    spacing: { before: 400, after: 200 },
                    border: {
                        bottom: {
                            color: primaryColor,
                            space: 1,
                            style: docx.BorderStyle.SINGLE,
                            size: 3
                        }
                    }
                })
            );
            
            const paragraphs = section.content.split('\n').filter(p => p.trim());
            paragraphs.forEach(para => {
                const cleaned = cleanText(para);
                if (cleaned) {
                    children.push(
                        new docx.Paragraph({
                            text: cleaned,
                            spacing: { after: 150 },
                            indent: { left: 360 }
                        })
                    );
                }
            });
        }
    });
    
    return children;
}

function cleanText(text) {
    if (!text) return '';
    
    return text
        .replace(/\*\*/g, '')
        .replace(/\*/g, '')
        .replace(/#{1,6}\s/g, '')
        .replace(/^\d+\.\s/gm, '• ')
        .replace(/^-\s/gm, '• ')
        .trim();
}

function getCurrentVisionText() {
    const fullText = conversationHistory
        .filter(msg => msg.role === 'assistant')
        .map(msg => msg.content)
        .join('\n\n');
    const sections = parseVisionBoard(fullText);
    return sections.vision || '';
}

async function saveVisionToSettings() {
    const visionText = getCurrentVisionText();

    if (!visionText) {
        alert('No vision defined yet. Complete the Vision section first.');
        return;
    }

    try {
        const res = await Auth.fetch('/api/settings', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body:    JSON.stringify({ vision: visionText })
        });

        if (res.ok) {
            localStorage.removeItem('visionBoardReturnToSettings');
            localStorage.removeItem('visionBoardCurrentVision');
            window.location.href = '/Modules/Settings/settings.html';
        }
    } catch (e) {
        console.error('Error saving vision to settings:', e);
        alert('Error saving vision. Please try again.');
    }
}

function resetChat() {
    if (confirm('Are you sure you want to start over? This will clear the current conversation.')) {
        conversationHistory = [];
        
        const chatContainer = document.getElementById('chatContainer');
        chatContainer.innerHTML = `
            <div class="message bot-message">
                <div class="message-avatar">🤖</div>
                <div class="message-content">
                    <p>Hello! I'm here to guide you through creating a Product Vision Board using Roman Pichler's methodology.</p>
                    <p>Let's start with 3 framing questions:</p>
                    <p><strong>1.</strong> What is your product in 1-2 sentences?<br>
                    <strong>2.</strong> Who is it for?<br>
                    <strong>3.</strong> What problem does it solve?</p>
                    <p>Please answer all three questions together.</p>
                </div>
            </div>
        `;
        
        document.getElementById('actionsContainer').style.display = 'none';
        document.getElementById('userInput').focus();
    }
}