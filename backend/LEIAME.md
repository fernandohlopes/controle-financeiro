# Backend (Google Apps Script)

`Code.gs` é o servidor do app: roda no Apps Script ligado à planilha.
Ele **não** é publicado pelo GitHub — para atualizar:

1. Planilha → Extensões → Apps Script → substitua o conteúdo de `Código.gs` por este arquivo e salve.
2. Implantar → Gerenciar implantações → ✎ → Versão: **Nova versão** (mantém a mesma URL).
3. Se o cabeçalho do arquivo pedir, rode as funções indicadas uma vez (`setupPlanilha`, `instalarBackup`, `instalarLembretes`).

A senha nunca fica neste arquivo: `definirAcesso` guarda só o hash nas Propriedades do script.

## Empréstimos e "Não cobrar" (novembro/2026)

Precisam desta versão do `Code.gs`. Enquanto o servidor for o antigo, o app
avisa e não deixa gravar (para nada se perder). Depois de publicar a nova
versão, rode `setupPlanilha` uma vez: ela cria a aba **Emprestimos** e a
coluna **perdoado** em Acertos (o app também cria sozinho no primeiro uso).

A aba Emprestimos só é lida com o login do administrador; o link pessoal de
cada pessoa nunca mostra empréstimos.
