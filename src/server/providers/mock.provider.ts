import { AIProvider, ChatCompletionOptions, StreamChatResult } from './provider.interface.js';
import { ModelInfo } from '../../types/index.js';
import { CLEAN_MODELS } from './nvidia.provider.js';
import { RAGService } from '../services/rag.service.js';

export class MockProvider implements AIProvider {
  name = 'Madura AI Core Engine';
  private ragService: RAGService;

  constructor(ragService: RAGService = new RAGService()) {
    this.ragService = ragService;
  }

  async streamChat(
    options: ChatCompletionOptions,
    onChunk: (token: string) => void,
    signal?: AbortSignal,
    onThoughtChunk?: (thoughtToken: string) => void
  ): Promise<StreamChatResult> {
    const isReasoning = Boolean(onThoughtChunk && (options.model?.includes('oss') || options.model === 'auto' || options.model === 'madura-4.0'));
    let thoughtText = '';
    let thoughtStartTime: number | null = null;
    let thoughtDurationMs: number | undefined;

    if (isReasoning && onThoughtChunk) {
      thoughtStartTime = Date.now();
      const lastMsg = options.messages[options.messages.length - 1]?.content || 'user inquiry';
      const promptSummary = lastMsg.slice(0, 60).replace(/\n/g, ' ');
      const thoughtThoughts = [
        `Analyzing query: "${promptSummary}"...\n`,
        `1. Evaluating core concepts, problem constraints, and required depth.\n`,
        `2. Formulating structured explanation with key points, practical examples, and clear takeaways.\n`,
        `3. Verifying clarity, accuracy, and formatting.\n`,
      ];
      for (const thought of thoughtThoughts) {
        if (signal?.aborted) {
          return { fullText: '', thought: thoughtText, finishReason: 'interrupted' };
        }
        thoughtText += thought;
        onThoughtChunk(thought);
        await new Promise(r => setTimeout(r, 20));
      }
      thoughtDurationMs = Math.max(120, Date.now() - thoughtStartTime);
    }

    const responseText = this.generateAssistantResponse(options);

    // Natural streaming cadence matching ChatGPT
    const words = responseText.split(/(\s+)/);
    let fullText = '';

    for (const word of words) {
      if (signal?.aborted) {
        return { fullText, thought: thoughtText || undefined, thoughtDurationMs, finishReason: 'interrupted' };
      }

      fullText += word;
      onChunk(word);

      const delay = Math.floor(Math.random() * 10) + 6;
      await new Promise(r => setTimeout(r, delay));
    }

    const lastMsg = options.messages[options.messages.length - 1]?.content || '';
    return {
      fullText,
      thought: thoughtText || undefined,
      thoughtDurationMs,
      finishReason: 'stop',
      usage: {
        promptTokens: Math.ceil(lastMsg.length / 4),
        completionTokens: Math.ceil(fullText.length / 4),
        totalTokens: Math.ceil((lastMsg.length + fullText.length) / 4),
      },
    };
  }

  async listModels(): Promise<ModelInfo[]> {
    return CLEAN_MODELS;
  }

  async testConnection(): Promise<{ success: boolean; latencyMs: number; message: string }> {
    return {
      success: true,
      latencyMs: 8,
      message: 'Madura AI Core Engine ready and operational',
    };
  }

  /**
   * Generates a high-quality, natural, ChatGPT-standard response
   */
  private generateAssistantResponse(options: ChatCompletionOptions): string {
    const messages = options.messages || [];
    const lastUserMessage = [...messages].reverse().find(m => m.role === 'user')?.content || '';
    const cleanPrompt = lastUserMessage.replace(/\[File:[^\]]+\][\s\S]*?\[End of [^\]]+\]/g, '').trim();
    const lower = cleanPrompt.toLowerCase().trim();

    // 1. Live Web Search Context (retrieved in real-time from Tavily API)
    if (lastUserMessage.includes('[Live Web Search Context for:')) {
      return this.synthesizeLiveSearchResponse(lastUserMessage);
    }

    // 2. Attached Document / File Context
    if (lastUserMessage.includes('Attached Document Context:')) {
      return this.analyzeDocumentContext(lastUserMessage, cleanPrompt);
    }

    // 3. Conversational Follow-up (Multi-turn Context)
    const prevAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant')?.content || '';
    if (prevAssistantMsg && (lower === 'explain more' || lower.includes('in more detail') || lower.includes('tell me more') || lower === 'elaborate')) {
      return this.elaborateOnPreviousTurn(prevAssistantMsg);
    }
    if (prevAssistantMsg && (lower.includes('convert to python') || lower.includes('in python'))) {
      return this.convertToPython(prevAssistantMsg);
    }
    if (prevAssistantMsg && (lower.includes('convert to javascript') || lower.includes('in javascript') || lower.includes('in typescript'))) {
      return this.convertToTypeScript(prevAssistantMsg);
    }

    // 4. Specific Model Inquiries ("what model are you?", "which model", "what model is this?")
    if (
      lower.includes('what model') ||
      lower.includes('which model') ||
      lower.includes('your model') ||
      lower.includes('what version') ||
      lower === 'model'
    ) {
      return `I'm Madura AI, running on NVIDIA NIM infrastructure. I'm not a specific numbered version — just Madura AI, here to help.`;
    }

    // 4b. Explanation of AI ("what is AI?", "what ai is", "what is artificial intelligence?")
    if (
      lower === 'what is ai' ||
      lower === 'what ai is' ||
      lower.includes('what is ai') ||
      lower.includes('what ai is') ||
      lower.includes('what is artificial intelligence') ||
      lower.includes('explain ai') ||
      lower.includes('how does ai work') ||
      lower.includes('what is an llm') ||
      lower.includes('what is a language model')
    ) {
      return `AI (Artificial Intelligence) refers to computer systems that can perform tasks typically requiring human intelligence — things like understanding language, recognizing patterns, making decisions, and generating content.

Modern AI assistants like me are built on **large language models (LLMs)** — neural networks trained on vast amounts of text that learn to predict and generate coherent, contextually appropriate responses. The "large" in LLM refers to both the scale of training data and the number of model parameters (often billions).`;
    }

    // 4c. Identity, Origin & Persona Questions ("who are you?", "what are you?", "tell me about yourself")
    if (
      lower.includes('who are you') ||
      lower.includes('what are you') ||
      lower.includes('tell me about yourself') ||
      lower.includes('introduce yourself') ||
      lower.includes('who is madura') ||
      lower.includes('what is madura') ||
      lower.includes('what is your name') ||
      lower.includes("what's your name") ||
      lower === 'are you an ai' ||
      lower === 'are you ai' ||
      lower.includes('are you chatgpt')
    ) {
      return `I'm **Madura AI** — a conversational AI assistant. I can help you with questions, writing, coding, analysis, and more. What would you like to work on?`;
    }

    // 4d. Creator & Development Questions ("who made you?", "who created you?", "who built you?")
    if (
      lower.includes('who made you') ||
      lower.includes('who created you') ||
      lower.includes('who built you') ||
      lower.includes('who trained you') ||
      lower.includes('who developed you')
    ) {
      return `I was developed as **Madura AI**, an intelligent conversational assistant.`;
    }

    // 4e. Capability Questions ("what can you do?", "how can you help?")
    if (
      lower.includes('what can you do') ||
      lower.includes('how can you help') ||
      lower.includes('what are your capabilities') ||
      lower.includes('your features')
    ) {
      return `I can help you with answering questions, writing and debugging code, drafting and editing text, solving mathematical problems, and analyzing data. What would you like to work on?`;
    }

    // 5. Greetings & Casual Pleasantries
    if (/^(hi|hello|hey|howdy|hola|greetings)[\s!.]*$/i.test(cleanPrompt)) {
      const greetings = [
        "Hello! How are you doing today? How can I help you?",
        "Hi there! How are you? What can I assist you with today?",
        "Hello! It's great to hear from you. What are you working on today, or how can I help?",
      ];
      return greetings[Math.floor(Math.random() * greetings.length)];
    }

    if (/^how are you( doing)?[\s!?.]*$/i.test(cleanPrompt) || lower.includes("how's it going") || lower.includes("how are you doing")) {
      return "I'm doing well, thank you for asking! How are things with you? Let me know what you'd like to work on or explore today.";
    }

    if (/^(good morning)[\s!.]*$/i.test(cleanPrompt)) {
      return "Good morning! I hope your day is starting off well. How can I help you today?";
    }

    if (/^(good afternoon)[\s!.]*$/i.test(cleanPrompt)) {
      return "Good afternoon! How can I assist you today?";
    }

    if (/^(good evening)[\s!.]*$/i.test(cleanPrompt)) {
      return "Good evening! I hope you've had a productive day. What can I help you with tonight?";
    }

    if (/^(what can you do|help me|capabilities)[\s!?.]*$/i.test(cleanPrompt)) {
      return `Here are some of the main things I can help you with:

- **Coding & Technical Problem Solving**: Writing, debugging, and explaining code in TypeScript, Python, JavaScript, SQL, C++, and more.
- **Concept Explanations**: Breaking down technical, scientific, or everyday concepts with intuitive examples and analogies.
- **Mathematics & Logic**: Solving equations, step-by-step arithmetic, calculus, and mathematical proofs.
- **Writing & Communication**: Drafting reports, essays, professional emails, and structured summaries.
- **Document & File Analysis**: Uploading and analyzing PDFs, DOCX, CSVs, and text files.
- **Live Web Research**: Searching for real-time information, breaking news, and current events via Tavily web search.

What would you like to work on?`;
    }

    if (/^(thank you|thanks|thx|appreciate it)[\s!.]*$/i.test(cleanPrompt)) {
      return "You're very welcome! If there's anything else you need or another question you'd like to explore, feel free to ask.";
    }

    if (lower.includes('tell me a joke') || lower.includes('joke')) {
      const jokes = [
        "Why do programmers prefer dark mode?\n\nBecause light attracts bugs! 😄",
        "There are 10 types of people in the world: those who understand binary, and those who don't.",
        "Why did the developer go broke?\n\nBecause they used up all their cache! 🪙",
      ];
      return jokes[Math.floor(Math.random() * jokes.length)];
    }

    // 6. Geography & Capital Cities
    const capitalResponse = this.tryAnswerCapital(cleanPrompt);
    if (capitalResponse) {
      return capitalResponse;
    }

    // 7. Everyday Science & Fact Inquiries ("Why is the sky blue", "How do planes fly", etc.)
    const scienceResponse = this.tryAnswerCommonScience(cleanPrompt);
    if (scienceResponse) {
      return scienceResponse;
    }

    // 8. Perspectives & Discussion Topics (Stock Market, AI, Crypto, Finance, etc.)
    const perspectiveResponse = this.tryAnswerPerspectivesAndInquiries(cleanPrompt);
    if (perspectiveResponse) {
      return perspectiveResponse;
    }

    // 9. Creative Writing, Essays, Poems, Letters
    if (
      lower.startsWith('write a poem') ||
      lower.startsWith('write an essay') ||
      lower.startsWith('write a story') ||
      lower.startsWith('write an email') ||
      lower.startsWith('draft an email')
    ) {
      return this.generateCreativeWriting(cleanPrompt);
    }

    // 9. Arithmetic & Math Calculations
    const mathResponse = this.trySolveMath(cleanPrompt);
    if (mathResponse) {
      return mathResponse;
    }

    // 10. World Leaders, Heads of State & Government Entities
    const entityResponse = this.tryAnswerWorldLeadersAndEntities(cleanPrompt);
    if (entityResponse) {
      return entityResponse;
    }

    // 11. Programming & Code Requests
    if (
      lower.includes('code') ||
      lower.includes('function') ||
      lower.includes('python') ||
      lower.includes('javascript') ||
      lower.includes('typescript') ||
      lower.includes('react') ||
      lower.includes('sql') ||
      lower.includes('algorithm') ||
      lower.includes('implement') ||
      lower.includes('component')
    ) {
      return this.generateCodeResponse(cleanPrompt);
    }

    // 11. Explanations ("Explain X", "What is X", "How does X work", "Why is X")
    if (
      lower.startsWith('explain ') ||
      lower.startsWith('what is ') ||
      lower.startsWith("what's ") ||
      lower.startsWith('how does ') ||
      lower.startsWith('how do ') ||
      lower.startsWith('why is ') ||
      lower.startsWith('why do ') ||
      lower.includes('tell me about ') ||
      lower.includes('difference between ')
    ) {
      return this.generateExplanationResponse(cleanPrompt);
    }

    // 12. Dynamic General Knowledge & Advice
    return this.generateDynamicResponse(cleanPrompt);
  }

  /**
   * Capital cities lookup
   */
  private tryAnswerCapital(prompt: string): string | null {
    const lower = prompt.toLowerCase();
    const capitals: Record<string, { city: string; country: string; extra: string }> = {
      france: { city: 'Paris', country: 'France', extra: 'Located on the Seine River, Paris has been one of the world’s major centres of commerce, culture, and art for centuries.' },
      germany: { city: 'Berlin', country: 'Germany', extra: 'Berlin is known for its rich history, vibrant culture, and as a major European technological and artistic hub.' },
      japan: { city: 'Tokyo', country: 'Japan', extra: 'Tokyo is the most populous metropolitan area in the world, renowned for blending ultra-modern innovation with historic traditions.' },
      italy: { city: 'Rome', country: 'Italy', extra: 'Rome, known as the "Eternal City," boasts nearly three millennia of globally influential history and architecture.' },
      spain: { city: 'Madrid', country: 'Spain', extra: 'Madrid is Spain’s central capital, renowned for its historic plazas, art museums, and bustling culture.' },
      uk: { city: 'London', country: 'United Kingdom', extra: 'London is a global financial and cultural center standing along the River Thames.' },
      'united kingdom': { city: 'London', country: 'United Kingdom', extra: 'London is a global financial and cultural center standing along the River Thames.' },
      england: { city: 'London', country: 'England', extra: 'London is a global financial and cultural center standing along the River Thames.' },
      usa: { city: 'Washington, D.C.', country: 'United States', extra: 'Washington, D.C. is home to all three branches of the U.S. federal government, including the White House and Capitol.' },
      'united states': { city: 'Washington, D.C.', country: 'United States', extra: 'Washington, D.C. is home to all three branches of the U.S. federal government, including the White House and Capitol.' },
      india: { city: 'New Delhi', country: 'India', extra: 'New Delhi serves as the seat of government and is an integral part of the Delhi metropolitan area.' },
      china: { city: 'Beijing', country: 'China', extra: 'Beijing is one of the world’s oldest continuously inhabited capitals, famous for both modern architecture and ancient heritage sites.' },
      canada: { city: 'Ottawa', country: 'Canada', extra: 'Ottawa is located in the province of Ontario on the border with Quebec, known for Parliament Hill.' },
      australia: { city: 'Canberra', country: 'Australia', extra: 'Canberra was planned specifically as the national capital, situated between Sydney and Melbourne.' },
      brazil: { city: 'Brasília', country: 'Brazil', extra: 'Brasília is famous for its distinctive airplane-shaped urban layout and modernist architecture designed by Oscar Niemeyer.' },
      russia: { city: 'Moscow', country: 'Russia', extra: 'Moscow is Europe’s largest city by population, famous for the Kremlin and Red Square.' },
      egypt: { city: 'Cairo', country: 'Egypt', extra: 'Cairo sits near the Nile Delta and the ancient pyramids of Giza, serving as the cultural heart of the Arab world.' },
      'south korea': { city: 'Seoul', country: 'South Korea', extra: 'Seoul is a thriving modern metropolis renowned for technology, cuisine, and cultural influence.' },
    };

    for (const [country, info] of Object.entries(capitals)) {
      if (lower.includes(`capital of ${country}`) || lower.includes(`capital city of ${country}`)) {
        return `The capital of **${info.country}** is **${info.city}**.

${info.extra}`;
      }
    }
    return null;
  }

  /**
   * Common scientific inquiries
   */
  private tryAnswerCommonScience(prompt: string): string | null {
    const lower = prompt.toLowerCase();

    if (lower.includes('why is the sky blue') || lower.includes('why is sky blue')) {
      return `### Why is the Sky Blue?

The sky appears blue because of a physical phenomenon called **Rayleigh scattering**:

1. **Sunlight Composition**: Sunlight (white light) consists of all colors of the rainbow, each having a different wavelength. Red and orange have longer wavelengths, while blue and violet have much shorter wavelengths.
2. **Atmospheric Gas Particles**: When sunlight enters Earth's atmosphere, it collides with nitrogen and oxygen molecules.
3. **Selective Scattering**: Shorter wavelengths scatter much more easily than longer wavelengths. Blue light is scattered in all directions about 10 times more efficiently than red light.
4. **Human Vision**: Although violet light is scattered even more than blue, human eyes are much more sensitive to blue light, and sunlight contains more blue than violet to begin with.

As a result, whenever you look up at the daytime sky away from the direct sun, you see the scattered blue light illuminating the atmosphere.`;
    }

    if (lower.includes('how do airplanes fly') || lower.includes('how does a plane fly') || lower.includes('how do planes fly')) {
      return `### How Do Airplanes Fly?

Airplanes fly by balancing **four fundamental aerodynamic forces**:

1. **Lift**: Generated primarily by the airplane's wings (airfoils). The wing shape causes air to move faster over the curved top than underneath it, creating lower pressure on top (Bernoulli’s Principle). Simultaneously, the angle of the wing deflects incoming air downward, producing an equal and opposite upward force (Newton’s Third Law).
2. **Weight (Gravity)**: The downward gravitational force pulling the aircraft toward the Earth. Lift must overcome weight for the plane to climb.
3. **Thrust**: Provided by jet engines or propellers, pushing the aircraft forward through the air.
4. **Drag**: The air resistance that opposes forward motion. Thrust must overcome drag to accelerate or maintain cruising speed.

When **Lift > Weight**, the plane climbs. When **Thrust > Drag**, the plane accelerates. During steady cruising flight, all four forces are in balance.`;
    }

    if (lower.includes('speed of light')) {
      return `### The Speed of Light

In a vacuum, the **speed of light** ($c$) is exactly:

$$c = 299,792,458 \\text{ meters per second}$$

This translates approximately to:
- **$300,000 \\text{ km/s}$**
- **$186,282 \\text{ miles per second}$**
- **$670.6 \\text{ million miles per hour}$**

According to Einstein’s theory of Special Relativity, $c$ is the universal speed limit for any matter or information traveling through spacetime.`;
    }

    if (lower.includes('black hole') || lower.includes('black holes')) {
      return `### What is a Black Hole?

A **black hole** is a region of spacetime where gravity is so intense that nothing—not even particles or electromagnetic radiation like light—can escape from it.

---

### Key Components
1. **Event Horizon**: The "point of no return." Once anything crosses this boundary, the escape velocity exceeds the speed of light.
2. **Singularity**: The theoretical center point where mass is compressed into infinite density and zero volume, where current laws of general relativity break down.
3. **Accretion Disk**: A superheated, swirling disk of gas and dust orbiting outside the event horizon, glowing brightly in X-rays before falling in.

### How They Form
Most stellar black holes form when massive stars (at least 20 times more massive than the Sun) exhaust their nuclear fuel and undergo a violent gravitational collapse during a supernova explosion.`;
    }

    if (lower.includes('photosynthesis')) {
      return `### What is Photosynthesis?

**Photosynthesis** is the biological process by which plants, algae, and some bacteria convert light energy into chemical energy stored in glucose molecules.

---

### The Chemical Equation
$$6\\text{CO}_2 + 6\\text{H}_2\\text{O} + \\text{Light Energy} \\longrightarrow \\text{C}_6\\text{H}_{12}\\text{O}_6 + 6\\text{O}_2$$

### Two Main Stages
1. **Light-Dependent Reactions**: Occur inside the thylakoid membranes of chloroplasts, using chlorophyll to absorb sunlight and split water molecules, releasing oxygen ($O_2$) and producing ATP and NADPH.
2. **Calvin Cycle (Light-Independent)**: Occurs in the stroma, utilizing ATP and NADPH to convert carbon dioxide ($CO_2$) into sugar (glucose).

Photosynthesis is the fundamental driver of almost all life on Earth, generating breathable oxygen and serving as the primary source of organic food energy.`;
    }

    return null;
  }

  /**
   * Creative Writing
   */
  private generateCreativeWriting(prompt: string): string {
    const clean = prompt.replace(/^(write a poem about|write an essay on|write a story about|write an email to)\s+/i, '').trim();

    if (prompt.toLowerCase().includes('poem')) {
      return `### ${clean.charAt(0).toUpperCase() + clean.slice(1)}

Beneath the quiet canopy of dusk,
A silver whisper stirs the waiting trees,
The daylight yields its amber-tinted husk,
And gentle currents ride the twilight breeze.

The world slows down to hear the evening chime,
Where shadows lengthen on the quiet stone,
A quiet pause within the rush of time,
Where thoughts take flight and wander on their own.

And as the night unfolds its starry deep,
The gentle calm of slumber settles in,
A silent promise that the shadows keep,
Until the morning and the light begin.`;
    }

    if (prompt.toLowerCase().includes('email')) {
      return `**Subject:** Update & Next Steps: ${clean || 'Project Overview'}

Dear Team,

I hope you are having a productive week.

I am writing to provide a concise update regarding **${clean || 'our ongoing initiatives'}** and outline our next steps.

**Key Highlights:**
- **Current Progress:** Milestones for the current cycle are progressing smoothly and remain on schedule.
- **Focus Areas:** We are currently reviewing implementation details and optimizing overall workflow efficiency.
- **Upcoming Deliverables:** Next phase reviews will take place early next week.

Please let me know if you have any questions or require additional details.

Best regards,  
**Madura AI**`;
    }

    return `### Essay on ${clean.charAt(0).toUpperCase() + clean.slice(1)}

**Introduction**  
The concept of ${clean} represents a compelling area of study with profound implications for both theory and practice. As our understanding expands, analyzing the fundamental elements of this subject reveals critical insights into its broader impact.

**Core Analysis**  
At its foundation, ${clean} operates at the intersection of innovation, structure, and human endeavor. Key factors influencing its development include technological evolution, resource optimization, and clear strategic alignment. When managed effectively, it fosters resilience and sustained advancement.

**Conclusion**  
In summary, ${clean} continues to shape our approach to problem-solving. By embracing thoughtful perspectives and rigorous standards, we can navigate future challenges with confidence and clarity.`;
  }

  /**
   * Perspectives on major conversational topics (Finance, Stock Market, AI, Crypto, etc.)
   */
  private tryAnswerPerspectivesAndInquiries(prompt: string): string | null {
    const lower = prompt.toLowerCase();

    // Stock Market & Investing
    if (
      lower.includes('stock market') ||
      lower.includes('stocks') ||
      lower.includes('investing') ||
      lower.includes('share market') ||
      lower.includes('stock exchange')
    ) {
      return `The stock market is one of the most powerful wealth-creation engines in history, but navigating it successfully requires patience, emotional discipline, and a sound strategy. Here is a balanced perspective on how to think about it:

### 1. The Core Purpose: Owning Productive Businesses
When you invest in stocks, you are buying fractional ownership in real companies that generate revenue, innovate, and expand. Over long horizons, the stock market reflects broader economic productivity and human ingenuity.

### 2. Long-Term Growth vs. Short-Term Volatility
- **In the short term**: The market is driven by sentiment, interest rates, news headlines, and fear or greed. Trying to predict short-term price movements is notoriously difficult, even for professional fund managers.
- **In the long run**: Historically, broad diversified index funds (such as the S&P 500) have produced an annualized return of approximately 7% to 10% before inflation over multi-decade periods.

### 3. Key Principles for Smart Investing
- **Diversification**: Broad index funds and ETFs significantly reduce the risk of any single company failing.
- **Dollar-Cost Averaging (DCA)**: Investing consistently regardless of whether the market is up or down smooths out purchase prices and removes emotion.
- **Time in the Market > Timing the Market**: Missing just the 10 best trading days over a 20-year period can cut total returns in half.

### 4. Managing Risks
- Expect market downturns and bear markets as normal features of the economic cycle.
- Avoid speculative trading or overleveraged positions unless you have high risk tolerance and deep domain expertise.

Are you interested in long-term index investing, a specific sector, or current market conditions?`;
    }

    // Cryptocurrency & Bitcoin
    if (
      lower.includes('crypto') ||
      lower.includes('bitcoin') ||
      lower.includes('btc') ||
      lower.includes('ethereum') ||
      lower.includes('cryptocurrency')
    ) {
      return `Cryptocurrency represents an innovative digital asset class built on blockchain technology. Here is a balanced breakdown of its role, potential, and risks:

### 1. Core Innovations
- **Decentralization**: Cryptocurrencies like Bitcoin operate on distributed ledgers without central intermediaries or single points of failure.
- **Digital Scarcity**: Bitcoin’s programmed supply cap of 21 million units introduces provable digital scarcity, often viewed as a store of value.
- **Programmable Money**: Platforms like Ethereum enable smart contracts, decentralized finance (DeFi), and verifiable digital ownership.

### 2. Key Risks to Consider
- **High Volatility**: Crypto markets regularly experience 50% to 80% drawdowns during market cycles.
- **Regulatory Landscape**: Global regulatory frameworks around taxation, compliance, and custody continue to evolve.
- **Self-Custody Responsibility**: Managing private keys requires personal responsibility to prevent loss or theft.

### 3. Common Strategy
Many investors treat crypto as a high-risk, high-reward asymmetric allocation (e.g., 1% to 5% of an overall portfolio) rather than replacing core traditional savings.`;
    }

    // Artificial Intelligence & Future of Jobs
    if (
      lower.includes('artificial intelligence') ||
      lower.includes('what you think about ai') ||
      lower.includes('what do you think about ai') ||
      lower.includes('will ai take') ||
      lower.includes('agi') ||
      lower.includes('future of ai')
    ) {
      return `Artificial Intelligence represents one of the most profound technological shifts of our time, comparable to the advent of the internet or electricity:

### 1. Augmentation vs. Replacement
- In the near term, AI functions primarily as an intellectual force multiplier. It dramatically accelerates writing, software engineering, data analysis, and creative drafting.
- Professionals who learn to effectively orchestrate AI tools tend to outperform those who do not.

### 2. Economic & Labor Shifts
- **Routine & Repetitive Tasks**: Being automated rapidly (data entry, transcription, basic boilerplate coding).
- **Higher-Order Skills**: Critical thinking, system architecture, human empathy, negotiation, and cross-disciplinary problem solving become increasingly valuable.
- **New Roles**: Prompt engineering, AI safety, machine learning ops, and domain-specific AI integration are rapidly expanding fields.

### 3. Key Challenges Ahead
- Ensuring data privacy, intellectual property protection, and mitigating hallucinations and bias.
- Establishing regulatory and safety guardrails to align powerful models with human values.

What specific aspect of AI are you most curious about?`;
    }

    return null;
  }

  /**
   * Dynamic fallback response for any general question
   */
  private generateDynamicResponse(prompt: string): string {
    const topic = cleanTopicName(prompt);
    const lower = prompt.toLowerCase();

    if (lower.includes('think about') || lower.includes('opinion') || lower.includes('thoughts on') || lower.includes('your view')) {
      return `On the topic of **${topic}**: there are genuinely compelling arguments on multiple sides.

From a practical standpoint, the key is to separate the hype from the fundamentals. What are the core trade-offs involved, the stakeholders affected, and the time horizons in play? Without those anchors, most opinions on ${topic} tend to swing too far in one direction.

Do you want to explore a specific angle — the technical side, the economic implications, or something else?`;
    }

    if (lower.startsWith('how to') || lower.startsWith('how can i') || lower.startsWith('how do i')) {
      return `To **${topic}**, here's a practical approach:

1. Start with a clear goal — define what success looks like before you begin.
2. Break the problem into smaller, concrete steps that each have a measurable outcome.
3. Identify the tools, resources, or dependencies you need upfront.
4. Execute iteratively: do the simplest version first, then refine.
5. Validate at each stage rather than waiting until the end.

Want me to go deeper on any specific step?`;
    }

    if (lower.startsWith('what is') || lower.startsWith("what's") || lower.startsWith('explain ') || lower.startsWith('tell me about')) {
      return `**${topic}** refers to ${topic.toLowerCase()} — a concept that spans multiple domains depending on context.

To give you a precise, useful answer, could you tell me a bit more about what you're trying to understand? For example: are you looking for a conceptual overview, a technical deep-dive, practical examples, or a comparison with something else?`;
    }

    // Completely unknown / open-ended
    return `I want to give you a genuinely useful answer about **${topic}**, but I want to make sure I'm addressing exactly what you're asking.

Could you rephrase or add a bit more detail to your question? The more specific you are, the better I can help.`;
  }

  /**
   * World Leaders, Heads of State & Key Global Entities Resolver
   */
  private tryAnswerWorldLeadersAndEntities(prompt: string): string | null {
    const lower = prompt.toLowerCase().trim();

    // 1. Prime Minister of India
    if (
      lower.includes('indian prime minister') ||
      lower.includes('prime minister of india') ||
      lower === 'pm of india' ||
      lower === 'indian pm' ||
      lower.includes('who is the prime minister of india') ||
      lower.includes('who is prime minister of india') ||
      lower.includes('current prime minister of india') ||
      lower.includes('who is the pm of india') ||
      lower === 'narendra modi' ||
      lower.includes('who is narendra modi')
    ) {
      return `The current Prime Minister of India is **Narendra Modi** (Narendra Damodardas Modi).

He has served as the **14th Prime Minister of the Republic of India** since May 26, 2014, and was sworn in for his third consecutive term on **June 9, 2024**, following the 2024 general parliamentary elections.

---

### 🏛️ Key Background & Tenure
- **Political Party**: Bharatiya Janata Party (BJP), leading the National Democratic Alliance (NDA).
- **Parliamentary Constituency**: Represents the Varanasi constituency in Uttar Pradesh in the Lok Sabha.
- **Tenure Length**: Currently the third-longest-serving Prime Minister in Indian history, after Jawaharlal Nehru and Indira Gandhi.
- **Prior Role**: Served as the Chief Minister of Gujarat from October 2001 to May 2014.

---

### 📜 Constitutional Role & Powers
Under the Constitution of India:
- **Head of Government**: The Prime Minister exercises executive authority and directs government policy.
- **Chief Advisor to President**: Recommends the appointment and dismissal of other ministers in the Union Council of Ministers.
- **Chair of Crucial Bodies**: Ex-officio Chairman of NITI Aayog, the Appointments Committee of the Cabinet (ACC), and the Nuclear Command Authority.

---

*Would you like more details on major national initiatives (e.g., Digital India, Make in India), foreign policy, or election history?*`;
    }

    // 2. President of India
    if (
      lower.includes('indian president') ||
      lower.includes('president of india') ||
      lower.includes('who is the president of india')
    ) {
      return `The current President of India is **Droupadi Murmu**.

She is the **15th President of the Republic of India**, serving since July 25, 2022. She is the first person belonging to a tribal community (Santhal) and the second woman (after Pratibha Patil) to hold the nation's highest constitutional office.

As President, she serves as the **Head of State** of India and the Supreme Commander of the Indian Armed Forces.`;
    }

    // 3. United States President
    if (
      lower.includes('us president') ||
      lower.includes('president of the united states') ||
      lower.includes('president of us') ||
      lower.includes('president of america') ||
      lower.includes('who is the president of the united states') ||
      lower.includes('who is us president')
    ) {
      return `The President of the United States serves as the **head of state and head of government** of the United States of America, and commander-in-chief of the U.S. Armed Forces.

Under Article II of the U.S. Constitution, the President is responsible for enforcing federal laws, directing the executive branch, nominating federal judges, and shaping foreign policy.`;
    }

    // 4. United Kingdom Prime Minister
    if (
      lower.includes('uk prime minister') ||
      lower.includes('prime minister of the uk') ||
      lower.includes('prime minister of the united kingdom') ||
      lower.includes('british prime minister') ||
      lower.includes('who is the prime minister of the uk')
    ) {
      return `The current Prime Minister of the United Kingdom is **Sir Keir Starmer**.

He assumed office on **July 5, 2024**, as the Prime Minister of the United Kingdom and First Lord of the Treasury, following the Labour Party's victory in the 2024 general election.`;
    }

    // 5. French President
    if (
      lower.includes('french president') ||
      lower.includes('president of france') ||
      lower.includes('who is the president of france')
    ) {
      return `The current President of France is **Emmanuel Macron**.

He has served as the President of the French Republic since May 2017 and was re-elected in April 2022. He is also the ex-officio Co-Prince of Andorra.`;
    }

    // 6. German Chancellor
    if (
      lower.includes('german chancellor') ||
      lower.includes('chancellor of germany') ||
      lower.includes('who is the chancellor of germany')
    ) {
      return `The current Chancellor of Germany is **Olaf Scholz**.

He has served as the Chancellor of the Federal Republic of Germany since December 8, 2021, leading a coalition government following Angela Merkel's tenure.`;
    }

    // 7. Chief Ministers in India (General Inquiry)
    if (
      lower.includes('chief minister') &&
      !lower.includes('who is the chief minister of')
    ) {
      return `In the Republic of India, a **Chief Minister** is the elected head of government of each of the 28 states and 3 union territories with a legislative assembly (Delhi, Puducherry, and Jammu & Kashmir).

- **Appointment**: Formally appointed by the State Governor, who invites the leader of the party or coalition commanding a majority in the Legislative Assembly (Vidhan Sabha).
- **Executive Power**: While the Governor is the nominal constitutional head of state, real executive authority resides with the Chief Minister and their Council of Ministers.

Which state's Chief Minister would you like to inquire about?`;
    }

    return null;
  }

  /**
   * Synthesizes live search results into a clean, ChatGPT-quality answer
   */
  private synthesizeLiveSearchResponse(fullPrompt: string): string {
    const matchQuery = /\[Live Web Search Context for: "([^"]+)"\]/.exec(fullPrompt);
    const query = matchQuery ? matchQuery[1] : 'your query';

    const matchSynthesis = /Direct Synthesis:\s*(.+?)(?=\n\n\[Source|\n\n\[System|$)/s.exec(fullPrompt);
    const directSynthesis = matchSynthesis ? matchSynthesis[1].trim() : '';

    // Extract sources
    const sourcesRegex = /\[Source \d+\]:\s*"([^"]+)"\s*\(([^)]+)\)\n([^\n]+)/g;
    const sources: Array<{ title: string; url: string; snippet: string }> = [];
    let match;
    while ((match = sourcesRegex.exec(fullPrompt)) !== null) {
      sources.push({
        title: match[1],
        url: match[2],
        snippet: match[3],
      });
    }

    let response = '';

    if (directSynthesis) {
      response += `${directSynthesis}\n\n`;
    } else {
      response += `Here is the verified, up-to-date information regarding **${query}**:\n\n`;
    }

    if (sources.length > 0) {
      response += `### 🌐 Sources & References\n`;
      sources.slice(0, 3).forEach((s) => {
        response += `- [${s.title}](${s.url})\n`;
      });
    }

    return response;
  }

  /**
   * Analyzes uploaded document/file context using RAG retrieval engine
   */
  private analyzeDocumentContext(fullPrompt: string, userQuery: string): string {
    const fileMatches = [...fullPrompt.matchAll(/\[File:\s*([^\]]+)\]\n([\s\S]*?)\n\[End of [^\]]+\]/g)];

    if (fileMatches.length === 0) {
      return "I have reviewed your attached file. How would you like me to process or analyze it?";
    }

    const firstFileName = fileMatches[0][1];
    const fileText = fileMatches[0][2];

    // Clean user query of any leftover artifact wrappers
    const cleanUserQuery = userQuery
      .replace(/\[File:[^\]]+\][\s\S]*?\[End of [^\]]+\]/g, '')
      .replace(/Attached Document Context:[\s\S]*$/g, '')
      .trim();

    return this.ragService.answerDocumentQuery(firstFileName, fileText, cleanUserQuery);
  }

  /**
   * Solves arithmetic and basic math problems step-by-step
   */
  private trySolveMath(prompt: string): string | null {
    const lower = prompt.toLowerCase().trim();

    // Percentage: "what is 15% of 85"
    const pctMatch = /(?:what is\s+)?(\d+(?:\.\d+)?)\s*%\s+of\s+(\d+(?:\.\d+)?)/i.exec(lower);
    if (pctMatch) {
      const pct = parseFloat(pctMatch[1]);
      const total = parseFloat(pctMatch[2]);
      const result = (pct / 100) * total;
      return `To find **${pct}% of ${total}**:

$$\\text{Result} = \\left( \\frac{${pct}}{100} \\right) \\times ${total} = ${result.toFixed(2)}$$

**Answer:** **${result}** (or **${result.toFixed(2)}** rounded to two decimal places).`;
    }

    // Linear equation: "solve 2x + 5 = 15"
    const eqMatch = /solve\s+([+-]?\d*)x\s*([+-]\s*\d+)\s*=\s*([+-]?\d+)/i.exec(lower);
    if (eqMatch) {
      const a = eqMatch[1] === '' || eqMatch[1] === '+' ? 1 : eqMatch[1] === '-' ? -1 : parseFloat(eqMatch[1]);
      const bStr = eqMatch[2].replace(/\s+/g, '');
      const b = parseFloat(bStr);
      const c = parseFloat(eqMatch[3]);
      const rhs = c - b;
      const x = rhs / a;

      return `Here is the step-by-step solution to solve for $x$:

**Given equation:**
$$${a === 1 ? '' : a}x ${b >= 0 ? '+ ' + b : '- ' + Math.abs(b)} = ${c}$$

**Step 1:** Subtract ${b} from both sides:
$$${a === 1 ? '' : a}x = ${c} - (${b}) = ${rhs}$$

**Step 2:** Divide both sides by ${a}:
$$x = \\frac{${rhs}}{${a}} = ${x}$$

**Final Answer:**
$$x = ${x}$$`;
    }

    // Simple arithmetic: "25 * 14", "125 / 5", "45 + 55", "100 - 37"
    const arithMatch = /^(?:what is\s+|calculate\s+)?(\d+(?:\.\d+)?)\s*([+\-*/×÷])\s*(\d+(?:\.\d+)?)$/i.exec(lower);
    if (arithMatch) {
      const n1 = parseFloat(arithMatch[1]);
      const op = arithMatch[2];
      const n2 = parseFloat(arithMatch[3]);
      let res = 0;
      let opSym = op;

      if (op === '+' || opSym === '+') res = n1 + n2;
      else if (op === '-' || opSym === '-') res = n1 - n2;
      else if (op === '*' || op === '×') { res = n1 * n2; opSym = '×'; }
      else if (op === '/' || op === '÷') { res = n2 !== 0 ? n1 / n2 : NaN; opSym = '÷'; }

      return `$$${n1} ${opSym} ${n2} = ${res}$$

**Answer:** **${res}**`;
    }

    return null;
  }

  /**
   * Generates clean, robust code with clear explanations
   */
  private generateCodeResponse(prompt: string): string {
    const lower = prompt.toLowerCase();

    // Palindrome
    if (lower.includes('palindrome')) {
      return `Here is an efficient implementation to check if a string is a palindrome in Python:

\`\`\`python
def is_palindrome(s: str) -> bool:
    """
    Checks if a string is a palindrome, ignoring non-alphanumeric characters and case.
    Time Complexity: O(n)
    Space Complexity: O(1) using two pointers
    """
    left, right = 0, len(s) - 1
    
    while left < right:
        while left < right and not s[left].isalnum():
            left += 1
        while left < right and not s[right].isalnum():
            right -= 1
            
        if s[left].lower() != s[right].lower():
            return False
            
        left += 1
        right -= 1
        
    return True

# Example test cases:
print(is_palindrome("A man, a plan, a canal: Panama")) # True
print(is_palindrome("race a car"))                     # False
print(is_palindrome("Was it a car or a cat I saw?"))   # True
\`\`\`

### How It Works
1. **Two Pointers**: We move \`left\` forward and \`right\` backward toward the center.
2. **Ignores Punctuation & Case**: \`.isalnum()\` skips spaces and symbols, while \`.lower()\` ensures case-insensitivity.
3. **Space-Efficient ($O(1)$)**: Does not create a reversed copy of the string in memory.`;
    }

    // TypeScript / JavaScript
    if (lower.includes('typescript') || lower.includes('javascript') || lower.includes('js') || lower.includes('ts')) {
      if (lower.includes('fibonacci')) {
        return `Here is an efficient implementation of the Fibonacci sequence in TypeScript:

\`\`\`typescript
/**
 * Calculates the nth Fibonacci number using dynamic programming (O(n) time, O(1) space).
 */
export function fibonacci(n: number): number {
  if (n < 0) throw new Error('Input must be a non-negative integer');
  if (n <= 1) return n;

  let prev = 0;
  let curr = 1;

  for (let i = 2; i <= n; i++) {
    const next = prev + curr;
    prev = curr;
    curr = next;
  }

  return curr;
}

// Example usage:
console.log(fibonacci(0));  // 0
console.log(fibonacci(1));  // 1
console.log(fibonacci(10)); // 55
\`\`\`

### How It Works
1. **Constant Space ($O(1)$)**: Keeps track of just the last two numbers rather than an entire call stack.
2. **Linear Time ($O(n)$)**: Calculates the answer in a single loop from 2 up to $n$.`;
      }

      if (lower.includes('debounce') || lower.includes('throttle')) {
        return `Here is a production-ready **debounce** function in TypeScript:

\`\`\`typescript
export function debounce<T extends (...args: any[]) => any>(
  func: T,
  waitMs: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;

  return function (...args: Parameters<T>): void {
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }

    timeoutId = setTimeout(() => {
      func(...args);
      timeoutId = null;
    }, waitMs);
  };
}

// Example usage:
const handleSearch = debounce((query: string) => {
  console.log('Searching for:', query);
}, 300);

handleSearch('apple');
handleSearch('banana'); // Only 'banana' executes after 300ms
\`\`\`

### Key Points
- **Type-Safe**: Uses TypeScript's \`Parameters<T>\` to preserve argument types.
- **Timer Clearing**: Cancels any in-flight execution if invoked again within the delay window.`;
      }

      // General TypeScript function
      return `Here is a clean, robust TypeScript function tailored to your request:

\`\`\`typescript
/**
 * Processes items concurrently with bounded concurrency
 */
export async function mapConcurrent<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let currentIndex = 0;

  async function worker(): Promise<void> {
    while (currentIndex < items.length) {
      const index = currentIndex++;
      results[index] = await fn(items[index], index);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// Example usage:
async function demo() {
  const urls = ['item-1', 'item-2', 'item-3', 'item-4'];
  const processed = await mapConcurrent(urls, 2, async (url) => {
    return \`Processed \${url}\`;
  });
  console.log(processed);
}
\`\`\`

### Key Architecture Highlights
1. **Bounded Concurrency**: Prevents overwhelming downstream resources by limiting simultaneous workers.
2. **Order Preservation**: Allocates the results array up-front so items stay in their original index order.
3. **Type Safety**: Generics \`<T, R>\` guarantee compile-time safety.`;
    }

    // Python
    if (lower.includes('python')) {
      return `Here is a clean, idiomatic Python solution:

\`\`\`python
from typing import List, Dict, Any

def process_records(records: List[Dict[str, Any]], key: str) -> Dict[str, List[Dict[str, Any]]]:
    """
    Groups a list of dictionary records by a specified key.
    """
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    
    for item in records:
        group_val = str(item.get(key, "Unknown"))
        if group_val not in grouped:
            grouped[group_val] = []
        grouped[group_val].append(item)
        
    return grouped

# Example usage:
if __name__ == "__main__":
    data = [
        {"name": "Alice", "role": "Engineering"},
        {"name": "Bob", "role": "Design"},
        {"name": "Charlie", "role": "Engineering"},
    ]
    
    result = process_records(data, key="role")
    print(result)
\`\`\`

### Explanation
1. **Type Annotations**: Utilizes Python's \`typing\` module for clarity and IDE auto-completion.
2. **Safe Key Retrieval**: Uses \`.get(key, "Unknown")\` to prevent \`KeyError\` on missing fields.
3. **Efficiency**: Operates in $O(n)$ linear time.`;
    }

    // SQL
    if (lower.includes('sql') || lower.includes('query') || lower.includes('database')) {
      return `Here is an optimized SQL query:

\`\`\`sql
SELECT 
    u.id AS user_id,
    u.name AS user_name,
    COUNT(o.id) AS total_orders,
    COALESCE(SUM(o.amount), 0.00) AS total_spent
FROM 
    users u
LEFT JOIN 
    orders o ON u.id = o.user_id AND o.status = 'completed'
WHERE 
    u.is_active = TRUE
GROUP BY 
    u.id, u.name
ORDER BY 
    total_spent DESC
LIMIT 10;
\`\`\`

### Key Points
- **LEFT JOIN**: Ensures users are included even if they have zero orders.
- **COALESCE**: Handles NULL values gracefully.
- **Indexes**: Recommend indexing \`orders(user_id, status)\` and \`users(is_active)\`.`;
    }

    // Default Code Snippet
    return `Here is a clean implementation for your request:

\`\`\`typescript
export function solveTask<T>(input: T[]): { count: number; unique: T[] } {
  const unique = Array.from(new Set(input));
  return {
    count: unique.length,
    unique,
  };
}

// Example usage:
const numbers = [1, 2, 2, 3, 4, 4, 5];
const result = solveTask(numbers);
console.log(result); // { count: 5, unique: [1, 2, 3, 4, 5] }
\`\`\`

Let me know if you would like me to adjust any specific requirements or add test cases!`;
  }

  /**
   * Generates comprehensive, well-structured explanations just like ChatGPT
   */
  private generateExplanationResponse(prompt: string): string {
    const lower = prompt.toLowerCase();

    // Quantum Computing
    if (lower.includes('quantum computing') || lower.includes('quantum computer')) {
      return `### What is Quantum Computing?

**Quantum computing** is a field of computer science and physics that utilizes the principles of quantum mechanics to solve complex problems exponentially faster than classical computers.

---

### How It Works: Classical vs. Quantum

1. **Bits vs. Qubits**:
   - **Classical Computers**: Use **bits** as the fundamental unit of information, which exist strictly as either \`0\` or \`1\`.
   - **Quantum Computers**: Use **qubits** (quantum bits). Thanks to quantum principles, a qubit can exist as \`0\`, \`1\`, or any quantum superposition of both simultaneously.

2. **Core Quantum Principles**:
   - **Superposition**: Allows qubits to process a vast number of possibilities at the same time. While 2 classical bits can represent 1 of 4 states at a time, 2 qubits in superposition can represent all 4 simultaneously.
   - **Entanglement**: Qubits can become intrinsically linked such that the state of one instantly dictates the state of another, regardless of distance.
   - **Interference**: Quantum algorithms use constructive interference to amplify correct solutions and destructive interference to cancel out incorrect ones.

---

### An Intuitive Analogy: The Maze
Imagine trying to escape a vast, complex maze:
- A **classical computer** explores one path at a time. If it hits a dead end, it backtracks and tests the next route.
- A **quantum computer** acts like water poured into the maze entrance—it flows through all possible corridors simultaneously, instantly finding the exit.

---

### Practical Applications
- **Cryptography**: Breaking and developing post-quantum encryption standards.
- **Drug Discovery & Molecular Modeling**: Simulating complex molecular interactions that are impossible for supercomputers.
- **Financial Optimization**: Optimizing massive multi-asset portfolios and algorithmic risk modeling.
- **Supply Chain Logistics**: Solving complex routing and combinatorial traveling-salesperson problems.`;
    }

    // APIs
    if (lower.includes('api') && !lower.includes('nvidia')) {
      return `### What is an API?

An **API** (Application Programming Interface) is a set of defined rules, protocols, and tools that allows different software applications to communicate and share data with one another.

---

### How It Works: The Restaurant Analogy

Think of an API like a **waiter in a restaurant**:
1. **You (The Client)**: You sit at the table and look at the menu. You want food, but you cannot walk into the kitchen to prepare it yourself.
2. **The Waiter (The API)**: The waiter takes your order, brings it to the kitchen, and delivers the prepared dish back to your table.
3. **The Kitchen (The Server / Database)**: The kitchen processes the order, cooks the meal, and packages it for delivery.

---

### Common Types of APIs
- **REST APIs**: The most widely used architecture on the web, using standard HTTP methods (\`GET\`, \`POST\`, \`PUT\`, \`DELETE\`).
- **GraphQL**: A modern query language that lets clients request precisely the fields they need.
- **WebSocket APIs**: Real-time, bidirectional channels used for chat apps, live trading, and multiplayer games.`;
    }

    // Recursion
    if (lower.includes('recursion')) {
      return `### What is Recursion?

In computer science, **recursion** is a programming technique where a function calls itself to solve smaller instances of the exact same problem until it reaches a designated stopping condition.

---

### The Two Fundamental Rules of Recursion

Every recursive function must contain two essential parts:
1. **The Base Case**: The condition under which the function stops calling itself. Without a base case, the function loops infinitely until it crashes with a \`StackOverflowError\`.
2. **The Recursive Step**: The part where the function breaks the problem down into a smaller sub-problem and calls itself with the reduced input.

---

### Example: Factorial ($n!$)

The factorial of 4 ($4!$) is $4 \\times 3 \\times 2 \\times 1 = 24$.

\`\`\`typescript
function factorial(n: number): number {
  // 1. Base Case: stop when n reaches 1 or 0
  if (n <= 1) return 1;

  // 2. Recursive Step: n * factorial(n - 1)
  return n * factorial(n - 1);
}
\`\`\`

---

### When to Use Recursion
- **Tree & Graph Traversal**: Navigating DOM nodes, file system directories, or JSON trees.
- **Divide-and-Conquer Algorithms**: Quicksort, Mergesort, and Binary Search.`;
    }

    // General Explanation for Any Concept
    const topic = cleanTopicName(prompt);
    return `**${topic}** is a broad subject — to give you an accurate and useful explanation, could you be more specific about what aspect you want to understand? For example: how it works mechanically, when to use it, how it compares to alternatives, or a concrete example?`;
  }

  /**
   * Elaborates on previous assistant message
   */
  private elaborateOnPreviousTurn(prevText: string): string {
    return `Here is a deeper, more detailed exploration of what we discussed:

### Advanced Perspectives & Key Nuances
1. **Architectural Trade-offs**: When scaling this approach, balance computational overhead against implementation complexity.
2. **Edge Cases to Watch For**:
   - Ensure proper error boundaries and timeouts are established.
   - Handle resource disposal and concurrency race conditions.
3. **Best Practices in Production**:
   - Monitor operational metrics and telemetry.
   - Implement graceful fallbacks and caching strategies where appropriate.

Would you like to walk through a concrete implementation or run benchmark comparisons?`;
  }

  private convertToPython(prevText: string): string {
    return `Here is the equivalent implementation written in idiomatic Python 3:

\`\`\`python
from typing import Any, List, Dict

def execute_solution(data: List[Any]) -> Dict[str, Any]:
    """
    Python implementation adapted from the previous discussion.
    """
    processed = [item for item in data if item is not None]
    return {
        "status": "success",
        "count": len(processed),
        "items": processed
    }

if __name__ == "__main__":
    sample = [1, 2, None, 4, 5]
    print(execute_solution(sample))
\`\`\`

Let me know if you would like me to add custom exceptions, type guards, or unit tests!`;
  }

  private convertToTypeScript(prevText: string): string {
    return `Here is the TypeScript implementation:

\`\`\`typescript
export interface ProcessResult<T> {
  status: 'success' | 'error';
  count: number;
  items: T[];
}

export function executeSolution<T>(data: (T | null | undefined)[]): ProcessResult<T> {
  const items = data.filter((item): item is T => item !== null && item !== undefined);
  return {
    status: 'success',
    count: items.length,
    items,
  };
}
\`\`\`

Fully typed with generic type narrowing and null safety.`;
  }
}

function cleanTopicName(prompt: string): string {
  let clean = prompt
    .replace(/^(explain|what is|what's|how does|why is|tell me about|what do you think about|what you think about|what are your thoughts on|your opinion on|how to|can you explain|what about)\s+/i, '')
    .replace(/[?!.]*$/, '')
    .trim();
  clean = clean.replace(/^(the|a|an)\s+/i, '').trim();
  if (!clean) return 'this subject';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}
