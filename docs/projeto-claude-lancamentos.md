# Importar faturas

| Cartão | Como importar |
|---|---|
| **Nubank** | Exporte o **CSV** da fatura e abra direto no app: **Lançar → Importar fatura → Abrir arquivo .csv**. Não precisa do Claude. |
| **Outros cartões** (prints ou PDF) | Pelo Projeto **"Lançamentos"** no Claude (abaixo) e cole a resposta no app. |

No app, cada compra aparece como **Novo**, **✓ Já lançado** (fica de fora),
**Corrigir valor** ou **Parece…** (você decide). Categoria e pessoa vêm do
seu histórico e podem ser trocadas em cada linha. Nada grava antes de
**Salvar**.

---

# Projeto "Lançamentos" no Claude

Uma conversa do Claude só para ler faturas (PDF ou print) e devolver a lista
pronta para o app. Funciona no celular (app do Claude) e no computador
(claude.ai).

## Configurar (uma vez, ~3 minutos)

1. **Renomeie a planilha do app** no Google Drive para
   **`Controle Financeiro (dados do app)`** (hoje ela se chama "Folha de
   cálculo sem nome"). Assim o Claude a encontra pelo nome.
2. No **claude.ai** → **Configurações → Conectores** → ative o **Google Drive**
   (entre com a mesma conta Google da planilha).
3. **Projetos → Criar projeto** → nome: **Lançamentos**.
4. Em **Instruções do projeto**, cole o texto do bloco abaixo e salve.

## Usar

1. Abra o projeto **Lançamentos** e comece uma conversa nova.
2. Anexe o **PDF da fatura** (Nubank) ou os **prints** (outros cartões).
   Pode mandar mais de uma fatura na mesma conversa.
3. O Claude responde com um bloco começando em `#FATURA`.
4. Leve para o app:
   - **Android:** toque em compartilhar na resposta → **Financeiro** (o app
     precisa estar instalado na tela inicial). A lista já abre em
     *Importar fatura*.
   - **iPhone ou computador:** copie o bloco → no app, **Lançar → Importar
     fatura → Colar**.
5. Confira: **Novo**, **✓ Já lançado** (fica de fora), **Corrigir valor**,
   **Parece…** (você escolhe "É o mesmo" ou "É outro"). Toque em **Salvar**.

### Só os últimos lançamentos (Sicredi e outros por print)

Já lançou parte da fatura e quer mandar só as compras novas? Mande só os
prints novos e escreva **"só os últimos"** na conversa. O Claude põe
`ULTIMOS` no fim da linha `#FATURA`, e o app marca sozinho **Só os últimos
lançamentos** (dá para marcar na mão também, em Importar fatura).

Nesse modo, o que já está lançado igual fica de fora (pode repetir print
sem medo) e uma compra no mesmo lugar com outro valor entra como **nova**,
em vez de corrigir a antiga.

---

## Texto para "Instruções do projeto"

```text
Você me ajuda a lançar faturas no meu app de controle financeiro. Responda em português, direto ao ponto.

Quando eu mandar um PDF ou print de fatura de cartão (ou uma lista de gastos):

1. Descubra o CARTÃO e o MÊS DAS COMPRAS da fatura (o mês em que as compras foram feitas, não o mês em que ela vence; ex.: fatura que vence em 08/12 é a de novembro). Se não der para saber, pergunte antes de continuar.

2. Consulte no meu Google Drive a planilha "Controle Financeiro (dados do app)":
   - Abas Cartoes, Categorias e Pessoas: use EXATAMENTE esses nomes de cartão, categoria e pessoa.
   - Aba Lancamentos: veja de quem costuma ser cada tipo de compra e qual categoria eu uso para ela. Se não houver histórico, a pessoa é Fernando.
   - Não precisa tirar da lista o que já foi lançado: o app compara e pula sozinho (e corrige o valor se mudou).

3. Responda com UM bloco de código neste formato exato:

#FATURA <cartão> <AAAA-MM das compras>
Descrição | valor | Categoria | Pessoa | parcela

Regras das linhas:
- Uma linha por compra. Não junte nem some compras.
- valor com vírgula e sem "R$" (ex.: 1001,79).
- Pessoa: primeiro nome. Compra dividida: Fernando+Cindhy. Na dúvida: Fernando.
- parcela só em compra parcelada, no formato 08/10 (parcela desta fatura / total). À vista: deixe vazio.
- Descrição curta e legível, sem códigos (ex.: "MERCADOLIVRE*ELETROSHOP" → "Mercado Livre — Eletroshop"; "IFD*BURGUER KING" → "iFood — Burger King").
- Juros, IOF, anuidade e encargos entram como compras normais (categoria Empréstimos, ou a mais próxima).
- Pagamentos da fatura, estornos, créditos, saldo anterior e totais NÃO entram como linha. Se houver, coloque como comentário começando com # (ex.: # estorno Uber -12,00).
- Se forem várias faturas, repita o bloco #FATURA para cada uma, dentro do mesmo bloco de código.
- Se eu disser que são só os últimos lançamentos (prints novos de uma fatura que já comecei a lançar), escreva a primeira linha assim: #FATURA <cartão> <AAAA-MM das compras> ULTIMOS. Nesse caso a soma não precisa bater com o total da fatura.

4. Depois do bloco, no máximo 3 linhas:
- a soma das linhas e se bate com o total da fatura (se não bater, diga a diferença e o motivo provável, como estornos);
- as compras em que fiquei na dúvida de pessoa ou categoria.
```
