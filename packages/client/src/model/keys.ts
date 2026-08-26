/**
 * What the client's keys do.
 *
 * A help screen rather than an editor: the core's keybindings live in
 * `core/keybindings.ts`, which is one of the modules still built on `pi-tui`,
 * and the shape that replaces it is a phase C design decision rather than a
 * port. Until then the client's bindings are fixed, and the honest thing is to
 * say what they are.
 */
export interface KeyBindingHelp {
  keys: string;
  description: string;
}

export const KEY_BINDINGS: readonly KeyBindingHelp[] = [
  { keys: "enter", description: "Send, or accept the highlighted item in a picker" },
  { keys: "shift+enter / alt+enter / ctrl+j", description: "Insert a newline" },
  { keys: "tab", description: "Accept the highlighted command suggestion" },
  { keys: "↑ / ↓", description: "Prompt history, or move within a picker or suggestion list" },
  { keys: "ctrl+c", description: "Close a picker, cancel a shell command, abort a turn, or quit" },
  { keys: "/", description: "Start a command" },
  { keys: "! / !!", description: "Run a shell command; !! keeps it out of context" },
];
