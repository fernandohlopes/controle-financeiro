# Backend (Google Apps Script)

`Code.gs` é o servidor do app: roda no Apps Script ligado à planilha.
Ele **não** é publicado pelo GitHub — para atualizar:

1. Planilha → Extensões → Apps Script → substitua o conteúdo de `Código.gs` por este arquivo e salve.
2. Implantar → Gerenciar implantações → ✎ → Versão: **Nova versão** (mantém a mesma URL).
3. Se o cabeçalho do arquivo pedir, rode as funções indicadas uma vez (`setupPlanilha`, `instalarBackup`, `instalarLembretes`).

A senha nunca fica neste arquivo: `definirAcesso` guarda só o hash nas Propriedades do script.
