// Downstream extension registration point.
//
// This file is intentionally empty in the open-source distribution.
// Downstream distributions (e.g. hyperdx-ee) REPLACE this file's body to
// register their extensions, for example:
//
//   import { registerAgentRunExtension } from '@/services/agentRunExtensions';
//   registerAgentRunExtension(myNotebookTrackingExtension);
//
// CONTRACT: upstream never edits this file after its creation, so downstream
// replacements never conflict on upstream merges. Add new registration
// surfaces via new register* calls in downstream copies — not by editing
// core modules.

export {};
