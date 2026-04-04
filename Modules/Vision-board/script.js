
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
Direct, efficient, no compromise on Pichler criteria. Signal violations immediately.

Start with: "Let's create your Vision Board. Answer these 3 questions: 1) Your product in 1-2 sentences? 2) For whom? 3) What problem does it solve?"`;

async function generateVisionBoard() {
    const productName = document.getElementById('productName').value.trim();
    const productGoals = document.getElementById('productGoals').value.trim();
    const targetMarket = document.getElementById('targetMarket').value.trim();
    const additionalContext = document.getElementById('additionalContext').value.trim();

    if (!productName || !productGoals) {
        alert('Please fill in at least Product Name and Product Goals');
        return;
    }

    document.getElementById('loading').style.display = 'block';
    document.getElementById('outputCard').style.display = 'none';
    document.getElementById('generateBtn').disabled = true;

    // Nouveau format - conversation guidée
    const userMessage = `Product: ${productName}

Goals & Context: ${productGoals}

${targetMarket ? `Target Market: ${targetMarket}` : ''}

${additionalContext ? `Additional Context: ${additionalContext}` : ''}

Please guide me through creating a complete Vision Board using the step-by-step process.`;

    try {
        const response = await fetch('http://localhost:3001/api/generate', {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: JSON.stringify({
                model: 'claude-3-5-sonnet-20241022',
                max_tokens: 4000,
                system: SYSTEM_PROMPT,  // Ajoute le system prompt!
                messages: [{
                    role: 'user',
                    content: userMessage
                }]
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('API Error Response:', errorData);
            throw new Error(`API Error: ${response.status}`);
        }

        const data = await response.json();
        const visionBoard = data.content[0].text;

        document.getElementById('output').textContent = visionBoard;
        document.getElementById('outputCard').style.display = 'block';

        document.getElementById('outputCard').scrollIntoView({ 
            behavior: 'smooth',
            block: 'start'
        });

    } catch (error) {
        console.error('Error:', error);
        alert('Error generating Vision Board.\n\nError: ' + error.message);
    } finally {
        document.getElementById('loading').style.display = 'none';
        document.getElementById('generateBtn').disabled = false;
    }
}

function copyToClipboard() {
    const output = document.getElementById('output').textContent;
    navigator.clipboard.writeText(output).then(() => {
        const btn = document.querySelector('.copy-btn');
        const originalText = btn.textContent;
        btn.textContent = '✅ Copied!';
        setTimeout(() => {
            btn.textContent = originalText;
        }, 2000);
    }).catch(err => {
        console.error('Copy failed:', err);
        alert('Failed to copy. Please select and copy manually.');
    });
}