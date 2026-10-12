import { createContext } from 'react';

// Callbacks live in context (not node data) so node data stays serializable.
export interface NodeCallbacks {
  onConfigChange: (nodeId: string, configJson: string) => void;
  onRemove: (nodeId: string) => void;
  onPlayNode: (nodeId: string) => void;
  onToggleKeep: (nodeId: string, output: string) => void;
  onRemoveInput: (nodeId: string, inputIndex: number) => void;
}

export const NodeCallbacksContext = createContext<NodeCallbacks>({
  onConfigChange: () => {},
  onRemove: () => {},
  onPlayNode: () => {},
  onToggleKeep: () => {},
  onRemoveInput: () => {},
});
