import { describe, it, expect } from 'vitest';
import { computeDiagramLayout, DiagramData } from '../src/client/components/InteractiveDiagram';

describe('Interactive Diagram Layout Engine', () => {
  const sampleLLMDiagram: DiagramData = {
    type: 'flow',
    title: 'LLM Inference Process',
    summary: 'How a Large Language Model generates a response from user input.',
    direction: 'LR',
    groups: [
      { id: 'input', label: 'Input Stage', color: 'blue' },
      { id: 'core', label: 'Processing Core', color: 'purple' },
      { id: 'output', label: 'Output Stage', color: 'green' },
    ],
    nodes: [
      { id: '1', label: 'User Input', subtitle: 'Text or prompt', group: 'input' },
      { id: '2', label: 'Tokenization', subtitle: 'Text to numerical tokens', group: 'input' },
      { id: '3', label: 'Embedding & Positional Encoding', subtitle: 'Tokens to vectors', group: 'core' },
      { id: '4', label: 'Transformer Blocks', subtitle: 'Contextual understanding', group: 'core' },
      { id: '5', label: 'Output Layer', subtitle: 'Predict next token', group: 'output' },
      { id: '6', label: 'Token Decoding', subtitle: 'Tokens to human text', group: 'output' },
    ],
    edges: [
      { from: '1', to: '2', label: 'text' },
      { from: '2', to: '3', label: 'embeddings' },
      { from: '3', to: '4', label: 'token IDs' },
      { from: '4', to: '5', label: 'contextual data' },
      { from: '5', to: '6', label: 'predicted tokens' },
    ],
  };

  it('arranges groups into non-colliding rows without splitting groups across rows', () => {
    const layout = computeDiagramLayout(sampleLLMDiagram, 800);

    const pos1 = layout.positions.get('1')!;
    const pos2 = layout.positions.get('2')!;
    const pos3 = layout.positions.get('3')!;
    const pos4 = layout.positions.get('4')!;
    const pos5 = layout.positions.get('5')!;
    const pos6 = layout.positions.get('6')!;

    // Input Stage nodes should share row 0
    expect(pos1.row).toBe(0);
    expect(pos2.row).toBe(0);

    // Processing Core nodes should share row 1
    expect(pos3.row).toBe(1);
    expect(pos4.row).toBe(1);

    // Output Stage nodes should share row 2
    expect(pos5.row).toBe(2);
    expect(pos6.row).toBe(2);
  });

  it('guarantees no group labels overlap or share colliding coordinates', () => {
    const layout = computeDiagramLayout(sampleLLMDiagram, 800);
    const bands = layout.groupBands;

    expect(bands.length).toBeGreaterThanOrEqual(3);

    for (let i = 0; i < bands.length; i++) {
      for (let j = i + 1; j < bands.length; j++) {
        const b1 = bands[i];
        const b2 = bands[j];

        const xOverlap = Math.abs(b1.labelX - b2.labelX) < 80;
        const yOverlap = Math.abs(b1.labelY - b2.labelY) < 20;

        // Both X and Y cannot collide at the same time
        expect(xOverlap && yOverlap).toBe(false);
      }
    }
  });

  it('guarantees horizontal gap between cards fits edge label pills with clearance', () => {
    const layout = computeDiagramLayout(sampleLLMDiagram, 800);

    // Find horizontal edges (same row)
    layout.calcEdges.forEach((edge) => {
      const src = layout.positions.get(edge.from)!;
      const tgt = layout.positions.get(edge.to)!;

      if (src.row === tgt.row && edge.label) {
        const cardGap = tgt.x - (src.x + layout.CARD_W);
        // The gap between cards must strictly exceed the pill width
        expect(cardGap).toBeGreaterThanOrEqual(edge.pillWidth);
        // And there should be at least 10px margin
        expect(cardGap - edge.pillWidth).toBeGreaterThanOrEqual(8);
      }
    });
  });

  it('guarantees group bounding boxes do not enclose foreign nodes', () => {
    const layout = computeDiagramLayout(sampleLLMDiagram, 800);

    layout.groupBands.forEach((gb) => {
      // Find all nodes inside this group's bounding box
      const nodesInside = sampleLLMDiagram.nodes.filter((node) => {
        const pos = layout.positions.get(node.id)!;
        return (
          pos.x >= gb.x &&
          pos.x + layout.CARD_W <= gb.x + gb.w &&
          pos.y >= gb.y &&
          pos.y + layout.CARD_H <= gb.y + gb.h
        );
      });

      // Every node inside this group's band must actually belong to this group
      nodesInside.forEach((node) => {
        expect(node.group).toBe(gb.group.id);
      });
    });
  });
});
