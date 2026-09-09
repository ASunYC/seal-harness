# @seal-harness/lsp-stdio

Generic stdio LSP host. Each configured server is selected by file extension, starts lazily once per canonical workspace, serializes transient `didOpen → query → didClose` operations, bounds source/protocol/stderr input, and shuts down on plugin disposal. No language server is bundled.
