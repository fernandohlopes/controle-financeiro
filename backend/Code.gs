/**
 * CONTROLE FINANCEIRO — Backend via Google Apps Script + Google Sheets
 * ======================================================================
 * Publique como "App da Web" vinculado a uma Planilha Google com as abas:
 * Lancamentos, Receitas, Pessoas, Categorias, Cartoes, Recorrentes.
 *
 * CONFIGURAÇÃO (primeira vez OU ao atualizar a partir da versão com senha só):
 * 1. Extensões > Apps Script. Substitua todo o conteúdo por este arquivo.
 * 2. Rode `setupPlanilha` uma vez (cria as abas que faltarem e acerta os
 *    formatos das colunas; não apaga nada).
 * 3. Edite USUARIO e SENHA em `definirAcesso` e rode a função uma vez.
 *    Depois APAGUE a senha do código (volte para o texto padrão) e salve:
 *    ela fica guardada só como hash nas Propriedades do script.
 * 4. Implantar > Gerenciar implantações > ✎ (editar) > Versão: Nova versão.
 *    Isso mantém a MESMA URL /exec. (Na primeira vez: Implantar > Nova
 *    implantação > App da Web · Executar como: Eu · Quem pode acessar:
 *    Qualquer pessoa.)
 * 5. Configurações do projeto > Fuso horário: America/Sao_Paulo. As datas
 *    de pagamento e a virada de mês das cobranças fixas usam esse fuso.
 * 6. (Recomendado) Rode `instalarBackup` uma vez: cópia semanal da planilha
 *    numa pasta privada do seu Drive.
 * 7. (Recomendado) Rode `instalarLembretes` uma vez: e-mail quando uma
 *    fatura estiver perto do vencimento (precisa do dia de vencimento do
 *    cartão, em Ajustes no app).
 *
 * ACESSO
 * - Administrador: usuário + senha. O login devolve uma SESSÃO (código
 *   aleatório) com validade: 30 dias com "Manter conectado" (renovada
 *   sozinha enquanto o app é usado) ou 12 horas sem. A senha nunca fica
 *   gravada no aparelho.
 * - 5 tentativas erradas bloqueiam o login por 15 minutos. Senha errada no
 *   "Apagar tudo" conta no mesmo limite.
 * - Trocar a senha (rodar `definirAcesso` de novo) derruba todas as sessões.
 * - `encerrarTodasSessoes` (pelo editor ou pelo app) desconecta todos os
 *   aparelhos.
 * - Links pessoais (?token=...) continuam sem login e são só de leitura.
 * - A planilha NÃO precisa estar compartilhada: o script roda como você.
 *   Deixe o compartilhamento dela em "Restrito".
 *
 * COBRANÇAS FIXAS (aba Recorrentes)
 * - Cada linha é uma REGRA: descrição, valor, quem paga, forma de pagamento,
 *   mês de início e (opcional) mês de fim.
 * - Na carga dos dados o servidor cria o lançamento dos meses que faltam,
 *   do mês de início até o mês atual, e anota em `ultimo_mes` até onde já
 *   gerou. Ele NUNCA volta atrás: apagar uma parcela no extrato não a traz
 *   de volta, e editar a regra só alcança os meses ainda não gerados.
 * - Os lançamentos gerados têm grupo_id = "REC-<id da regra>".
 *
 * PAGAMENTOS
 * - Cada lançamento tem `pago` ("sim" ou vazio) e `pago_em` (data). Marcar a
 *   fatura de um cartão é uma escrita só, na aba Lancamentos.
 * - `pago_em` é o dia em que o pagamento foi marcado NO APARELHO (mesmo que
 *   ele só chegue aqui depois, pela fila offline).
 *
 * ORÇAMENTO
 * - A aba Categorias tem uma coluna `limite`: o teto mensal de gastos daquela
 *   categoria, usado pelas barras do painel. Vazio ou 0 = sem limite.
 *
 * APAGAR DADOS
 * - "Apagar lançamentos e receitas" exige a senha do administrador, conferida
 *   aqui por hash. Sessão aberta não basta.
 */

const SHEET_LANCAMENTOS = 'Lancamentos';
const SHEET_RECEITAS    = 'Receitas';
const SHEET_PESSOAS     = 'Pessoas';
const SHEET_CATEGORIAS  = 'Categorias';
const SHEET_CARTOES     = 'Cartoes';
const SHEET_RECORRENTES = 'Recorrentes';
const SHEET_ACERTOS     = 'Acertos';

const COLUNAS_LANCAMENTOS = ['id','descricao','mes','valor','responsavel','cartao','categoria','parcelas','parcela_atual','grupo_id','pago','pago_em'];
const COLUNAS_RECORRENTES = ['id','descricao','valor','responsavel','cartao','categoria','mes_inicio','mes_fim','ativa','ultimo_mes'];
const COLUNAS_CATEGORIAS  = ['id','nome','limite','icone'];
const COLUNAS_CARTOES     = ['id','nome','fechamento','vencimento'];
const COLUNAS_ACERTOS     = ['mes','pessoa','valor','recebido_em'];

const PREFIXO_REC          = 'REC-';
const MAX_MESES_GERADOS    = 240;  // trava de segurança por regra (20 anos)
const MAX_RECORRENTES_LOTE = 20;   // cotas de uma cobrança dividida

const SESSAO_DIAS_MANTER   = 30;
const SESSAO_RENOVAR_DIAS  = 15;  // com "manter", renova quando faltar menos que isto
const SESSAO_HORAS_CURTA   = 12;
const LOGIN_MAX_FALHAS     = 5;
const LOGIN_BLOQUEIO_MIN   = 15;
const CHAVE_FALHAS         = 'login_falhas';
const HASH_ITERACOES       = 1000;
const PREFIXO_SESSAO       = 'SESSAO_';

// Ações que alteram dados — só estas pegam a trava de escrita.
const ACOES_ESCRITA = [
  'addLancamentos','updateLancamento','deleteLancamento','deleteLancamentos',
  'marcarPagos','upsertReceita','addPessoa','removerPessoa','regenerarToken',
  'addCategoria','removerCategoria','definirOrcamento','addCartao','removerCartao',
  'addRecorrente','addRecorrentes','updateRecorrente','removerRecorrente',
  'limparDados','sincronizar','definirCartao','definirIcone','marcarAcerto'
];
// O que a fila offline do app pode mandar dentro de `sincronizar`.
const ACOES_FILA = ['addLancamentos','updateLancamento','deleteLancamentos','marcarPagos','upsertReceita','marcarAcerto'];

// ═══════════════════════════════════════════════════════════
//  SETUP (rodar manualmente pelo editor)
// ═══════════════════════════════════════════════════════════
function setupPlanilha() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  criarAba(ss, SHEET_LANCAMENTOS, COLUNAS_LANCAMENTOS);
  criarAba(ss, SHEET_RECEITAS,    ['mes','valor']);
  criarAba(ss, SHEET_PESSOAS,     ['id','nome','email','token']);
  criarAba(ss, SHEET_CATEGORIAS,  COLUNAS_CATEGORIAS);
  criarAba(ss, SHEET_CARTOES,     COLUNAS_CARTOES);
  criarAba(ss, SHEET_ACERTOS,     COLUNAS_ACERTOS);
  criarAba(ss, SHEET_RECORRENTES, COLUNAS_RECORRENTES);
  // Abas que já existiam ganham as colunas novas sem perder nada.
  garantirColunas(SHEET_LANCAMENTOS, COLUNAS_LANCAMENTOS);
  garantirColunas(SHEET_CATEGORIAS,  COLUNAS_CATEGORIAS);
  garantirColunas(SHEET_CARTOES,     COLUNAS_CARTOES);
  avisar('Planilha configurada com sucesso!');
}

/* Acrescenta na primeira linha os cabeçalhos que faltam (versões antigas da
   planilha não tinham pago/pago_em nem limite). Só escreve o que está fora
   do lugar, e nunca apaga dados. */
function garantirColunas(nomeAba, colunas) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(nomeAba);
  if (!sheet) return false;
  if (sheet.getMaxColumns() < colunas.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), colunas.length - sheet.getMaxColumns());
  }
  const atuais = sheet.getRange(1, 1, 1, colunas.length).getValues()[0];
  let mudou = false;
  for (let i = 0; i < colunas.length; i++) {
    if (String(atuais[i]).trim() === colunas[i]) continue;
    sheet.getRange(1, i + 1).setValue(colunas[i]).setFontWeight('bold');
    mudou = true;
  }
  if (mudou) {
    if (nomeAba === SHEET_LANCAMENTOS) sheet.getRange('K2:L').setNumberFormat('@');
    if (nomeAba === SHEET_CATEGORIAS) sheet.getRange('C2:C').setNumberFormat('0.00');
  }
  return mudou;
}

function criarAba(ss, nome, cabecalhos) {
  let sheet = ss.getSheetByName(nome);
  if (!sheet) sheet = ss.insertSheet(nome);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(cabecalhos);
    sheet.getRange(1, 1, 1, cabecalhos.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  // Colunas de texto precisam ser TEXTO: senão o Sheets transforma o mês em
  // data (que escorrega conforme o fuso) e uma descrição "3/4" também.
  if (nome === SHEET_LANCAMENTOS) {
    sheet.getRangeList(['A2:C', 'E2:G', 'J2:L']).setNumberFormat('@');
    sheet.getRange('D2:D').setNumberFormat('0.00');
  } else if (nome === SHEET_CATEGORIAS) {
    sheet.getRange('A2:B').setNumberFormat('@');
    sheet.getRange('C2:C').setNumberFormat('0.00');
  } else if (nome === SHEET_RECEITAS) {
    sheet.getRange('A2:A').setNumberFormat('@');
    sheet.getRange('B2:B').setNumberFormat('0.00');
  } else if (nome === SHEET_ACERTOS) {
    sheet.getRangeList(['A2:B', 'D2:D']).setNumberFormat('@');
    sheet.getRange('C2:C').setNumberFormat('0.00');
  } else if (nome === SHEET_RECORRENTES) {
    sheet.getRangeList(['A2:B', 'D2:J']).setNumberFormat('@');
    sheet.getRange('C2:C').setNumberFormat('0.00');
  } else {
    sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), cabecalhos.length).setNumberFormat('@');
  }
  return sheet;
}

/* Define usuário e senha do administrador. Edite, rode UMA vez e depois
   volte a SENHA para o texto padrão antes de salvar. */
function definirAcesso() {
  const USUARIO = 'fernando';
  const SENHA   = 'TROQUE_AQUI_SUA_SENHA';

  if (USUARIO === 'TROQUE_AQUI_SEU_USUARIO' || SENHA === 'TROQUE_AQUI_SUA_SENHA') {
    throw new Error('Edite USUARIO e SENHA nesta função antes de executá-la.');
  }
  if (String(USUARIO).trim().length < 3) throw new Error('O usuário precisa ter pelo menos 3 caracteres.');
  if (String(SENHA).length < 8) throw new Error('A senha precisa ter pelo menos 8 caracteres.');

  const props = PropertiesService.getScriptProperties();
  const sal = Utilities.getUuid();
  props.setProperties({
    ADMIN_USUARIO: String(USUARIO).trim(),
    ADMIN_SAL: sal,
    ADMIN_HASH: hashSenha(SENHA, sal)
  });
  props.deleteProperty('ADMIN_SENHA'); // senha em texto puro da versão antiga
  encerrarTodasSessoes();
  CacheService.getScriptCache().remove(CHAVE_FALHAS);
  avisar('Acesso definido para o usuário "' + String(USUARIO).trim() +
         '". Todas as sessões anteriores foram encerradas.\n\n' +
         'Agora volte a SENHA para o texto padrão no código e salve.');
}

/* Desconecta todos os aparelhos. Pode rodar pelo editor ou pelo app. */
function encerrarTodasSessoes() {
  const props = PropertiesService.getScriptProperties();
  const todas = props.getProperties();
  let n = 0;
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf(PREFIXO_SESSAO) === 0) { props.deleteProperty(k); n++; }
  });
  Logger.log(n + ' sessão(ões) encerrada(s).');
  return { ok: true, encerradas: n };
}

// ═══════════════════════════════════════════════════════════
//  BACKUP SEMANAL
//  Rode `instalarBackup` UMA vez pelo editor (o Google vai pedir permissão
//  para o Drive). Toda segunda, de madrugada, uma cópia das abas vai para a
//  pasta "Controle Financeiro — Backups" no seu Drive. Ficam as últimas
//  BACKUP_MANTER cópias; as mais antigas vão para a lixeira (dá para
//  recuperar por 30 dias). A pasta é privada, como a planilha.
// ═══════════════════════════════════════════════════════════
const BACKUP_PASTA  = 'Controle Financeiro — Backups';
const BACKUP_MANTER = 12;

function instalarBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupSemanal') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('backupSemanal').timeBased()
    .onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(3).create();
  const url = backupSemanal();
  avisar('Backup semanal instalado (toda segunda, ~3h).\nPrimeira cópia criada agora:\n' + url);
}

function removerBackup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'backupSemanal') ScriptApp.deleteTrigger(t);
  });
  avisar('Backup semanal desligado. As cópias já feitas continuam na pasta.');
}

/* Copia só as abas (sem o script) para uma planilha nova. Pega a trava de
   escrita para a cópia não sair no meio de uma gravação. */
function backupSemanal() {
  const lock = LockService.getScriptLock();
  lock.waitLock(60000);
  let copia;
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const nome = 'Backup ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm');
    copia = SpreadsheetApp.create(nome);
    const inicial = copia.getSheets()[0];
    ss.getSheets().forEach(function (s) { s.copyTo(copia).setName(s.getName()); });
    copia.deleteSheet(inicial);
  } finally {
    lock.releaseLock();
  }
  const pasta = pastaBackup();
  DriveApp.getFileById(copia.getId()).moveTo(pasta);

  // Rotação: mantém só as mais recentes.
  const arquivos = [];
  const it = pasta.getFilesByType(MimeType.GOOGLE_SHEETS);
  while (it.hasNext()) arquivos.push(it.next());
  arquivos.sort(function (a, b) { return b.getDateCreated() - a.getDateCreated(); });
  arquivos.slice(BACKUP_MANTER).forEach(function (f) { f.setTrashed(true); });
  return copia.getUrl();
}

function pastaBackup() {
  const it = DriveApp.getFoldersByName(BACKUP_PASTA);
  return it.hasNext() ? it.next() : DriveApp.createFolder(BACKUP_PASTA);
}

/* Mensagem para quem rodou a função pelo editor: vai para o Registro de
   execução e, se a planilha estiver aberta, aparece como aviso no canto.
   Antes era getUi().alert(), que abria uma janela na aba da planilha e
   deixava a execução PARADA, esperando um clique em OK. */
function avisar(msg) {
  Logger.log(msg);
  try { SpreadsheetApp.getActiveSpreadsheet().toast(String(msg).slice(0, 300), 'Controle Financeiro', 15); } catch (e) {}
}

// ═══════════════════════════════════════════════════════════
//  ROTEAMENTO HTTP
// ═══════════════════════════════════════════════════════════
function doGet(e)  { return roteador(e); }
function doPost(e) { return roteador(e); }

function roteador(e) {
  let lock = null;
  try {
    const params = (e && e.parameter) || {};
    let body = {};
    if (e && e.postData && e.postData.contents) {
      try { body = JSON.parse(e.postData.contents); }
      catch (err) { return jsonOut({ erro: 'Corpo da requisição não é JSON válido.', codigo: 400 }); }
    }

    // Link pessoal: somente leitura, sem login.
    if (params.token) return jsonOut(acessoPorToken(params.token));

    const acao = body.acao;
    if (acao === 'login') return jsonOut(login(body.usuario, body.senha, body.manter));

    const sessao = validarSessao(body.sessao);
    if (!sessao) return jsonOut({ erro: 'Sua sessão expirou. Entre novamente.', codigo: 401 });

    if (acao === 'logout') {
      PropertiesService.getScriptProperties().deleteProperty(sessao.chave);
      return jsonOut({ ok: true });
    }

    // Serializa as escritas: duas requisições simultâneas não podem ler o
    // mesmo número de linha e agir sobre a linha errada.
    if (ACOES_ESCRITA.indexOf(acao) !== -1 || acao === 'encerrarSessoes') {
      lock = LockService.getScriptLock();
      if (!lock.tryLock(20000)) {
        lock = null;
        return jsonOut({ erro: 'O servidor está ocupado com outra gravação. Tente de novo em instantes.', codigo: 503, temporario: true });
      }
    }

    const resultado = executarAcao(acao, body, lock !== null);
    if (resultado && typeof resultado === 'object' && !Array.isArray(resultado) && acao !== 'encerrarSessoes') {
      resultado.sessaoExpiraEm = sessao.expira;
    }
    return jsonOut(resultado);

  } catch (err) {
    // Exceção do Apps Script/Sheets costuma ser passageira: o app pode repetir.
    return jsonOut({ erro: String(err && err.message ? err.message : err), codigo: 500, temporario: true });
  } finally {
    if (lock) lock.releaseLock();
  }
}

/* Separado do roteador para `sincronizar` reaproveitar as mesmas ações
   dentro da mesma trava e da mesma requisição. `travado` diz se a trava de
   escrita já está na mão (quem já a tem não pode tentar pegá-la de novo). */
function executarAcao(acao, body, travado) {
  switch (acao) {
    case 'carregarTudo':       return carregarTudo();
    case 'sincronizar':        return sincronizar(body.operacoes);
    case 'addLancamentos':     return addLancamentos(body.itens);
    case 'updateLancamento':   return updateLancamento(body.item);
    case 'deleteLancamento':   return deleteLancamentos([body.id]);
    case 'deleteLancamentos':  return deleteLancamentos(body.ids);
    case 'marcarPagos':        return marcarPagos(body.ids, body.pago, body.pagoEm);
    case 'upsertReceita':      return upsertReceita(body.mes, body.valor);
    case 'addPessoa':          return addPessoa(body.id, body.nome, body.email);
    case 'removerPessoa':      return removerLinha(SHEET_PESSOAS, body.id);
    case 'regenerarToken':     return regenerarToken(body.id);
    case 'addCategoria':       return addSimples(SHEET_CATEGORIAS, body.id, body.nome);
    case 'removerCategoria':   return removerLinha(SHEET_CATEGORIAS, body.id);
    case 'definirOrcamento':   return definirOrcamento(body.id, body.limite);
    case 'addCartao':          return addSimples(SHEET_CARTOES, body.id, body.nome);
    case 'removerCartao':      return removerLinha(SHEET_CARTOES, body.id);
    case 'definirCartao':      return definirCartao(body.id, body.fechamento, body.vencimento);
    case 'definirIcone':       return definirIcone(body.id, body.icone);
    case 'marcarAcerto':       return marcarAcerto(body.mes, body.pessoa, body.valor, body.recebido);
    case 'addRecorrente':      return addRecorrente(body, travado);
    case 'addRecorrentes':     return addRecorrentes(body.itens, travado);
    case 'updateRecorrente':   return updateRecorrente(body, travado);
    case 'removerRecorrente':  return removerRecorrente(body.id, body.apagarLancamentos);
    case 'limparDados':        return limparDados(body.senha, travado);
    case 'encerrarSessoes':    return encerrarTodasSessoes();
    default: return { erro: 'Ação desconhecida: ' + acao, codigo: 400 };
  }
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ═══════════════════════════════════════════════════════════
//  LOGIN E SESSÕES
// ═══════════════════════════════════════════════════════════
const MSG_BLOQUEIO = 'Muitas tentativas erradas. Aguarde ' + LOGIN_BLOQUEIO_MIN + ' minutos e tente de novo.';

/* Reserva uma tentativa ANTES de conferir a senha, dentro da trava. Antes,
   o contador era lido e só incrementado depois do hash: várias tentativas
   enviadas ao mesmo tempo liam o mesmo número e passavam do limite.
   Devolve {erro} se bloqueado, ou {restam} com as tentativas que sobram
   se esta também falhar. `travado` = a trava de escrita já está na mão. */
function reservarTentativa(travado) {
  let lock = null;
  if (!travado) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) {
      return { erro: 'O servidor está ocupado. Tente de novo em instantes.', codigo: 503, temporario: true };
    }
  }
  try {
    const cache = CacheService.getScriptCache();
    const falhas = parseInt(cache.get(CHAVE_FALHAS) || '0', 10);
    if (falhas >= LOGIN_MAX_FALHAS) return { erro: MSG_BLOQUEIO, codigo: 429 };
    cache.put(CHAVE_FALHAS, String(falhas + 1), LOGIN_BLOQUEIO_MIN * 60);
    return { restam: LOGIN_MAX_FALHAS - falhas - 1 };
  } finally {
    if (lock) lock.releaseLock();
  }
}

/* Senha certa: devolve a tentativa reservada (zera o contador). */
function tentativaOk() { CacheService.getScriptCache().remove(CHAVE_FALHAS); }

function msgFalha(restam, texto) {
  return restam > 0
    ? { erro: texto + ' ' + restam + ' tentativa(s) antes do bloqueio.', codigo: 401 }
    : { erro: MSG_BLOQUEIO, codigo: 429 };
}

function login(usuario, senha, manter) {
  const props = PropertiesService.getScriptProperties();
  const usuarioReal = props.getProperty('ADMIN_USUARIO');
  const hashReal = props.getProperty('ADMIN_HASH');
  const sal = props.getProperty('ADMIN_SAL');
  if (!usuarioReal || !hashReal || !sal) {
    return { erro: 'Acesso ainda não configurado. Rode definirAcesso no Apps Script.', codigo: 500 };
  }

  const reserva = reservarTentativa(false);
  if (reserva.erro) return reserva;

  // O hash é calculado mesmo com usuário errado: o tempo de resposta não
  // revela qual dos dois estava incorreto.
  const usuarioOk = String(usuario || '').trim().toLowerCase() === usuarioReal.toLowerCase();
  const senhaOk = igualSeguro(hashSenha(String(senha || ''), sal), hashReal);

  if (!usuarioOk || !senhaOk) {
    Utilities.sleep(700);
    return msgFalha(reserva.restam, 'Usuário ou senha incorretos.');
  }

  tentativaOk();
  limparSessoesExpiradas(props);

  const sessao = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  const agora = Date.now();
  const expira = agora + (manter ? SESSAO_DIAS_MANTER * 864e5 : SESSAO_HORAS_CURTA * 36e5);
  // Guarda só o hash do código: quem ler as propriedades não consegue usá-lo.
  props.setProperty(PREFIXO_SESSAO + sha256Hex(sessao), JSON.stringify({ expira: expira, manter: !!manter, criadaEm: agora }));

  return { ok: true, sessao: sessao, sessaoExpiraEm: expira, usuario: usuarioReal, manter: !!manter };
}

function validarSessao(sessao) {
  if (!sessao || typeof sessao !== 'string' || sessao.length < 32) return null;
  const props = PropertiesService.getScriptProperties();
  const chave = PREFIXO_SESSAO + sha256Hex(sessao);
  const raw = props.getProperty(chave);
  if (!raw) return null;
  let s;
  try { s = JSON.parse(raw); } catch (e) { props.deleteProperty(chave); return null; }
  const agora = Date.now();
  if (!s.expira || s.expira < agora) { props.deleteProperty(chave); return null; }
  // "Manter conectado": enquanto o app for usado, a sessão não vence.
  if (s.manter && s.expira - agora < SESSAO_RENOVAR_DIAS * 864e5) {
    s.expira = agora + SESSAO_DIAS_MANTER * 864e5;
    props.setProperty(chave, JSON.stringify(s));
  }
  return { chave: chave, expira: s.expira, manter: !!s.manter };
}

function limparSessoesExpiradas(props) {
  const todas = props.getProperties();
  const agora = Date.now();
  Object.keys(todas).forEach(function (k) {
    if (k.indexOf(PREFIXO_SESSAO) !== 0) return;
    try { if (JSON.parse(todas[k]).expira < agora) props.deleteProperty(k); }
    catch (e) { props.deleteProperty(k); }
  });
}

function hashSenha(senha, sal) {
  const chave = Utilities.newBlob(String(sal)).getBytes();
  let bytes = Utilities.computeHmacSha256Signature(Utilities.newBlob(String(senha)).getBytes(), chave);
  for (let i = 1; i < HASH_ITERACOES; i++) {
    bytes = Utilities.computeHmacSha256Signature(bytes, chave);
  }
  return bytesHex(bytes);
}

function sha256Hex(texto) {
  return bytesHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(texto), Utilities.Charset.UTF_8));
}

function bytesHex(bytes) {
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}

/* Confere a senha do administrador (usada nas ações destrutivas). */
function senhaConfere(senha) {
  const props = PropertiesService.getScriptProperties();
  const hash = props.getProperty('ADMIN_HASH'), sal = props.getProperty('ADMIN_SAL');
  if (!hash || !sal) return false;
  if (!senha) return false;
  return igualSeguro(hashSenha(String(senha), sal), hash);
}

function igualSeguro(a, b) {
  a = String(a); b = String(b);
  let dif = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    dif |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return dif === 0;
}

// ═══════════════════════════════════════════════════════════
//  SINCRONIZAÇÃO EM LOTE (fila offline do app)
// ═══════════════════════════════════════════════════════════
/* Recebe [{id, acao, dados}] e aplica em ordem. Para cada uma devolve:
   - ok: gravada (ou já estava gravada — reenviar é seguro);
   - definitivo: dado inválido, o app descarta;
   - temporario: falha do Google; a operação e as seguintes NÃO são
     processadas e ficam na fila do app para a próxima tentativa. */
function sincronizar(operacoes) {
  if (!operacoes || !operacoes.length) return { resultados: [] };
  const resultados = [];
  for (let i = 0; i < operacoes.length; i++) {
    const op = operacoes[i] || {};
    if (ACOES_FILA.indexOf(op.acao) === -1) {
      resultados.push({ id: op.id, ok: false, erro: 'Ação não permitida na fila: ' + op.acao, definitivo: true });
      continue;
    }
    try {
      const r = executarAcao(op.acao, op.dados || {}, true);
      if (r && r.erro) resultados.push({ id: op.id, ok: false, erro: r.erro, definitivo: true });
      else resultados.push({ id: op.id, ok: true });
    } catch (err) {
      resultados.push({ id: op.id, ok: false, erro: String(err && err.message ? err.message : err), definitivo: false });
      break; // as próximas podem depender desta (ex.: editar o que não foi criado)
    }
  }
  return { resultados: resultados };
}

// ═══════════════════════════════════════════════════════════
//  LEITURA
// ═══════════════════════════════════════════════════════════
function carregarTudo() {
  // Antes de ler: cria os lançamentos das cobranças fixas que ainda faltam,
  // para eles já voltarem nesta mesma resposta. Se falhar, a carga segue.
  try { materializarRecorrentes(true); } catch (err) { Logger.log('materializar: ' + err); }
  return {
    lancamentos: lerAba(SHEET_LANCAMENTOS),
    receitas:    lerAba(SHEET_RECEITAS),
    pessoas:     lerAba(SHEET_PESSOAS), // inclui token — só o admin logado vê
    categorias:  lerAba(SHEET_CATEGORIAS),
    cartoes:     lerAba(SHEET_CARTOES),
    recorrentes: lerAbaOpcional(SHEET_RECORRENTES),
    acertos:     lerAbaOpcional(SHEET_ACERTOS),
    usuario:     PropertiesService.getScriptProperties().getProperty('ADMIN_USUARIO') || '',
    servidorEm:  new Date().toISOString()
  };
}

function acessoPorToken(token) {
  token = String(token || '');
  if (token.length < 16) return { erro: 'Link inválido.', codigo: 404 };
  const pessoa = lerAba(SHEET_PESSOAS).filter(function (p) { return igualSeguro(String(p.token || ''), token); })[0];
  if (!pessoa) return { erro: 'Link inválido.', codigo: 404 };
  const lancamentos = lerAba(SHEET_LANCAMENTOS).filter(function (l) {
    return l.responsavel === pessoa.nome;
  }).map(function (l) {
    return { descricao: l.descricao, mes: l.mes, valor: l.valor, cartao: l.cartao, categoria: l.categoria,
             parcelas: l.parcelas, parcela_atual: l.parcela_atual, pago: l.pago };
  });
  return {
    nome: pessoa.nome,
    lancamentos: lancamentos,
    total: lancamentos.reduce(function (s, l) { return s + (parseFloat(l.valor) || 0); }, 0)
  };
}

// ═══════════════════════════════════════════════════════════
//  LANÇAMENTOS
// ═══════════════════════════════════════════════════════════
function validarItem(it) {
  if (!it || !it.id || String(it.id).length > 64) return 'Lançamento sem identificador.';
  if (!String(it.desc || '').trim()) return 'Lançamento sem descrição.';
  if (!/^\d{4}-\d{2}-01$/.test(String(it.mesDate || ''))) return 'Mês inválido: ' + it.mesDate;
  const v = Number(it.valor);
  if (!isFinite(v) || v < 0) return 'Valor inválido: ' + it.valor;
  return null;
}

/* Idempotente: um id que já está na planilha é ignorado. Assim, se a
   resposta se perder e o app reenviar, nada é gravado em dobro. */
function addLancamentos(itens) {
  if (!itens || !itens.length) return { ok: true, gravados: 0 };
  for (let i = 0; i < itens.length; i++) {
    const erro = validarItem(itens[i]);
    if (erro) return { erro: erro, codigo: 400 };
  }
  garantirColunasLancamentos();
  const sheet = aba(SHEET_LANCAMENTOS);
  const existentes = indiceDeIds(sheet);
  const vistos = {};
  const novos = itens.filter(function (it) {
    const id = String(it.id);
    if (existentes[id] || vistos[id]) return false;
    vistos[id] = true;
    return true;
  });
  if (!novos.length) return { ok: true, gravados: 0, jaExistiam: itens.length };

  const linhas = novos.map(function (it) {
    return [
      texto(it.id), texto(it.desc), texto(it.mesDate), arred(it.valor), texto(it.responsavel),
      texto(it.cartao), texto(it.categoria), parseInt(it.parcelas, 10) || 1,
      parseInt(it.parcelaAtual, 10) || 1, texto(it.grupoId || it.id),
      it.pago ? 'sim' : '', it.pago ? (dataValida(it.pagoEm) || hojeISO()) : ''
    ];
  });
  const inicio = sheet.getLastRow() + 1, fim = inicio + linhas.length - 1;
  sheet.getRangeList(['A' + inicio + ':C' + fim, 'E' + inicio + ':G' + fim, 'J' + inicio + ':L' + fim])
       .setNumberFormat('@');
  sheet.getRange(inicio, 1, linhas.length, COLUNAS_LANCAMENTOS.length).setValues(linhas);
  return { ok: true, gravados: linhas.length };
}

/* Marca (ou desmarca) lançamentos como pagos. Lê e grava as duas colunas de
   uma vez: marcar a fatura inteira de um cartão é uma escrita só.
   Idempotente — reenviar o mesmo pedido não muda nada.
   `pagoEm` é a data em que o pagamento foi marcado no aparelho. Antes o
   servidor usava a data de hoje: um pagamento marcado offline no sábado e
   sincronizado na segunda ficava como segunda. */
function marcarPagos(ids, pago, pagoEm) {
  if (!ids || !ids.length) return { ok: true, marcados: 0 };
  garantirColunasLancamentos();
  const sheet = aba(SHEET_LANCAMENTOS);
  const ultima = sheet.getLastRow();
  if (ultima < 2) return { ok: true, marcados: 0 };
  const alvo = {};
  ids.forEach(function (i) { alvo[String(i)] = true; });
  const coluna = sheet.getRange(1, 1, ultima, 1).getValues();
  const estado = sheet.getRange(2, 11, ultima - 1, 2).getValues();
  const quando = pago ? (dataValida(pagoEm) || hojeISO()) : '';
  let n = 0;
  for (let i = 1; i < coluna.length; i++) {
    if (!alvo[String(coluna[i][0])]) continue;
    estado[i - 1] = [pago ? 'sim' : '', quando];
    n++;
  }
  if (n) sheet.getRange(2, 11, ultima - 1, 2).setNumberFormat('@').setValues(estado);
  return { ok: true, marcados: n };
}

function updateLancamento(item) {
  const erro = validarItem(item);
  if (erro) return { erro: erro, codigo: 400 };
  const sheet = aba(SHEET_LANCAMENTOS);
  const linha = indiceDeIds(sheet)[String(item.id)];
  if (!linha) return { erro: 'Lançamento não encontrado (pode ter sido excluído).', codigo: 404 };
  sheet.getRange(linha, 2, 1, 6).setValues([[
    texto(item.desc), texto(item.mesDate), arred(item.valor),
    texto(item.responsavel), texto(item.cartao), texto(item.categoria)
  ]]);
  return { ok: true };
}

/* Apaga de baixo para cima: de cima para baixo os índices escorregariam.
   Linhas vizinhas saem num único deleteRows — apagar uma linha por vez
   levava dezenas de segundos numa cobrança fixa antiga, com a trava presa.
   Id que já não existe é ignorado (reenviar é seguro). */
function deleteLancamentos(ids) {
  if (!ids || !ids.length) return { ok: true, removidos: 0 };
  const sheet = aba(SHEET_LANCAMENTOS);
  const indice = indiceDeIds(sheet);
  const linhas = ids.map(function (id) { return indice[String(id)]; })
                    .filter(function (l, i, arr) { return !!l && arr.indexOf(l) === i; })
                    .sort(function (a, b) { return b - a; });
  let i = 0;
  while (i < linhas.length) {
    const fim = linhas[i];
    let inicio = fim;
    while (i + 1 < linhas.length && linhas[i + 1] === inicio - 1) { inicio--; i++; }
    sheet.deleteRows(inicio, fim - inicio + 1);
    i++;
  }
  return { ok: true, removidos: linhas.length };
}

// ═══════════════════════════════════════════════════════════
//  RECEITAS (upsert por mês)
// ═══════════════════════════════════════════════════════════
function upsertReceita(mes, valor) {
  mes = formatarData(mes);
  if (!/^\d{4}-\d{2}-01$/.test(mes)) return { erro: 'Mês inválido: ' + mes, codigo: 400 };
  const v = Number(valor);
  if (!isFinite(v) || v < 0) return { erro: 'Valor inválido: ' + valor, codigo: 400 };
  const sheet = aba(SHEET_RECEITAS);
  const dados = sheet.getDataRange().getValues();
  for (let i = 1; i < dados.length; i++) {
    if (formatarData(dados[i][0]) === mes) {
      sheet.getRange(i + 1, 2).setValue(arred(v));
      return { ok: true };
    }
  }
  const linha = sheet.getLastRow() + 1;
  sheet.getRange(linha, 1).setNumberFormat('@');
  sheet.getRange(linha, 1, 1, 2).setValues([[mes, arred(v)]]);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════
//  COBRANÇAS FIXAS (RECORRENTES)
// ═══════════════════════════════════════════════════════════
function validarRecorrente(it) {
  if (!it || !it.id || String(it.id).length > 64) return 'Cobrança sem identificador.';
  if (!String(it.desc || '').trim()) return 'Informe a descrição da cobrança.';
  const v = Number(it.valor);
  if (!isFinite(v) || v <= 0) return 'Valor inválido: ' + it.valor;
  if (!/^\d{4}-\d{2}-01$/.test(String(it.mesInicio || ''))) return 'Mês de início inválido: ' + it.mesInicio;
  if (it.mesFim) {
    if (!/^\d{4}-\d{2}-01$/.test(String(it.mesFim))) return 'Último mês inválido: ' + it.mesFim;
    if (String(it.mesFim) < String(it.mesInicio)) return 'O último mês é anterior ao mês de início.';
  }
  return null;
}

function linhaRecorrente(it) {
  return [
    String(it.id), texto(it.desc), arred(it.valor), texto(it.responsavel),
    texto(it.cartao || 'Sem cartão'), texto(it.categoria),
    String(it.mesInicio), String(it.mesFim || ''), it.ativa === false ? 'nao' : 'sim'
  ];
}

function abaRecorrentes() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_RECORRENTES)) criarAba(ss, SHEET_RECORRENTES, COLUNAS_RECORRENTES);
  return aba(SHEET_RECORRENTES);
}

function addRecorrente(item, travado) {
  const r = addRecorrentes([item], travado);
  if (r.erro) return r;
  return { ok: true, id: String(item.id), gerados: r.gerados };
}

/* Grava várias regras de uma vez — as cotas de uma cobrança dividida. Antes
   o app mandava uma requisição por pessoa e, se a segunda falhasse, a
   primeira ficava criada sozinha. Agora ou valida tudo ou não grava nada.
   Id que já existe (reenvio com resposta perdida) vira atualização. */
function addRecorrentes(itens, travado) {
  if (!itens || !itens.length) return { erro: 'Nenhuma cobrança enviada.', codigo: 400 };
  if (itens.length > MAX_RECORRENTES_LOTE) return { erro: 'Cobranças demais num pedido só.', codigo: 400 };
  for (let i = 0; i < itens.length; i++) {
    const erro = validarRecorrente(itens[i]);
    if (erro) return { erro: erro, codigo: 400 };
  }
  const sheet = abaRecorrentes();
  const indice = indiceDeIds(sheet);
  const novos = [];
  itens.forEach(function (it) {
    const linha = indice[String(it.id)];
    if (linha) {
      sheet.getRange(linha, 3).setNumberFormat('0.00');
      sheet.getRange(linha, 2, 1, 8).setValues([linhaRecorrente(it).slice(1)]);
    } else {
      novos.push(linhaRecorrente(it).concat(['']));  // ultimo_mes: nada gerado ainda
    }
  });
  if (novos.length) {
    const inicio = sheet.getLastRow() + 1;
    sheet.getRange(inicio, 1, novos.length, COLUNAS_RECORRENTES.length).setNumberFormat('@');
    sheet.getRange(inicio, 3, novos.length, 1).setNumberFormat('0.00');
    sheet.getRange(inicio, 1, novos.length, COLUNAS_RECORRENTES.length).setValues(novos);
  }
  const gerados = materializarRecorrentes(!travado);
  return { ok: true, ids: itens.map(function (it) { return String(it.id); }), gerados: gerados };
}

function updateRecorrente(item, travado) {
  const erro = validarRecorrente(item);
  if (erro) return { erro: erro, codigo: 400 };
  const sheet = abaRecorrentes();
  const linha = indiceDeIds(sheet)[String(item.id)];
  if (!linha) return { erro: 'Cobrança não encontrada (pode ter sido excluída).', codigo: 404 };
  sheet.getRange(linha, 3).setNumberFormat('0.00');
  // Colunas 2..9: ultimo_mes (10) não é mexido — o que já foi gerado, fica.
  sheet.getRange(linha, 2, 1, 8).setValues([linhaRecorrente(item).slice(1)]);
  const gerados = materializarRecorrentes(!travado);
  return { ok: true, gerados: gerados };
}

/* Apaga a regra. Com apagarLancamentos, apaga também o que ela já gerou. */
function removerRecorrente(id, apagarLancamentos) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(SHEET_RECORRENTES);
  if (sheet) {
    const linha = indiceDeIds(sheet)[String(id)];
    if (linha) sheet.deleteRow(linha);
  }
  let removidos = 0;
  if (apagarLancamentos) {
    const grupo = PREFIXO_REC + String(id);
    const ids = lerAba(SHEET_LANCAMENTOS)
      .filter(function (l) { return String(l.grupo_id) === grupo; })
      .map(function (l) { return l.id; });
    if (ids.length) removidos = deleteLancamentos(ids).removidos;
  }
  return { ok: true, removidos: removidos };
}

/* Para cada regra ativa, os lançamentos que faltam do mês de início (ou do
   mês seguinte ao último já gerado) até `hoje`, respeitando o mês de fim. */
function planejarRecorrentes(regras, hoje) {
  const pendentes = [], avancos = [];
  regras.forEach(function (r) {
    if (!r.id) return;
    if (String(r.ativa == null ? 'sim' : r.ativa).toLowerCase() === 'nao') return;
    if (!String(r.descricao || '').trim()) return;
    const valor = Number(r.valor);
    if (!isFinite(valor) || valor < 0) return;

    const inicio = mesChaveDe(r.mes_inicio);
    if (!inicio) return;
    const fim = mesChaveDe(r.mes_fim);
    const ultimo = mesChaveDe(r.ultimo_mes);

    let de = ultimo ? mesSeguinte(ultimo) : inicio;
    if (de < inicio) de = inicio;
    let ate = hoje;
    if (fim && fim < ate) ate = fim;
    if (de > ate) return;

    let cursor = de, criadoAte = null, guarda = 0;
    while (cursor <= ate && guarda++ < MAX_MESES_GERADOS) {
      pendentes.push({
        id: PREFIXO_REC + r.id + '-' + cursor.replace('-', ''),
        desc: r.descricao, mesDate: cursor + '-01', valor: valor,
        responsavel: r.responsavel, cartao: r.cartao || 'Sem cartão',
        categoria: r.categoria, parcelas: 1, parcelaAtual: 1,
        grupoId: PREFIXO_REC + r.id
      });
      criadoAte = cursor;
      cursor = mesSeguinte(cursor);
    }
    // Grava o avanço só até onde realmente gerou (a trava de 240 meses pode
    // ter cortado): o resto sai na próxima carga.
    if (criadoAte) avancos.push({ id: String(r.id), ate: criadoAte });
  });
  return { pendentes: pendentes, avancos: avancos };
}

/* Cria os lançamentos que faltam e anota o avanço em `ultimo_mes`; nunca
   volta atrás. `comTrava` = false quando o chamador já está com a trava.
   As regras são lidas DE NOVO depois de pegar a trava: com a leitura de
   antes, uma regra recém-removida ou um mês recém-apagado podia voltar,
   gerado a partir de um `ultimo_mes` desatualizado. */
function materializarRecorrentes(comTrava) {
  const hoje = mesAtualChave();
  // Olhada rápida, sem trava: na maioria das cargas não há nada a gerar.
  if (!planejarRecorrentes(lerAbaOpcional(SHEET_RECORRENTES), hoje).pendentes.length) return 0;

  let lock = null;
  if (comTrava !== false) {
    lock = LockService.getScriptLock();
    if (!lock.tryLock(15000)) return 0; // ocupado: tenta na próxima carga
  }
  try {
    const plano = planejarRecorrentes(lerAbaOpcional(SHEET_RECORRENTES), hoje);
    if (!plano.pendentes.length) return 0;
    const r = addLancamentos(plano.pendentes);
    if (r && r.erro) { Logger.log('materializar: ' + r.erro); return 0; }
    const sheet = aba(SHEET_RECORRENTES);
    const indice = indiceDeIds(sheet);
    plano.avancos.forEach(function (a) {
      const linha = indice[a.id];
      if (linha) sheet.getRange(linha, 10).setNumberFormat('@').setValue(a.ate + '-01');
    });
    return plano.pendentes.length;
  } finally {
    if (lock) lock.releaseLock();
  }
}

// ═══════════════════════════════════════════════════════════
//  PESSOAS / CATEGORIAS / CARTÕES
//  O id vem do app; repetir o mesmo pedido devolve o registro existente.
// ═══════════════════════════════════════════════════════════
function addPessoa(id, nome, email) {
  nome = String(nome || '').trim();
  if (!nome) return { erro: 'Informe o nome.', codigo: 400 };
  const sheet = aba(SHEET_PESSOAS);
  const existente = lerAba(SHEET_PESSOAS).filter(function (p) {
    return (id && String(p.id) === String(id)) || String(p.nome).trim().toLowerCase() === nome.toLowerCase();
  })[0];
  if (existente) {
    if (id && String(existente.id) !== String(id)) return { erro: 'Já existe uma pessoa com esse nome.', codigo: 409 };
    return existente;
  }
  id = id ? String(id) : Utilities.getUuid();
  const token = novoToken();
  const linha = sheet.getLastRow() + 1;
  sheet.getRange(linha, 1, 1, 4).setNumberFormat('@');
  sheet.getRange(linha, 1, 1, 4).setValues([[id, texto(nome), texto(email || ''), token]]);
  return { id: id, nome: nome, email: email || '', token: token };
}

/* Troca o token: o link pessoal antigo para de funcionar na hora. */
function regenerarToken(id) {
  const sheet = aba(SHEET_PESSOAS);
  const linha = indiceDeIds(sheet)[String(id)];
  if (!linha) return { erro: 'Pessoa não encontrada.', codigo: 404 };
  const token = novoToken();
  sheet.getRange(linha, 4).setNumberFormat('@').setValue(token);
  return { ok: true, id: id, token: token };
}

function addSimples(nomeAba, id, nome) {
  nome = String(nome || '').trim();
  if (!nome) return { erro: 'Informe o nome.', codigo: 400 };
  const sheet = aba(nomeAba);
  const existente = lerAba(nomeAba).filter(function (c) {
    return (id && String(c.id) === String(id)) || String(c.nome).trim().toLowerCase() === nome.toLowerCase();
  })[0];
  if (existente) {
    if (id && String(existente.id) !== String(id)) return { erro: 'Já existe com esse nome.', codigo: 409 };
    return existente;
  }
  id = id ? String(id) : Utilities.getUuid();
  const linha = sheet.getLastRow() + 1;
  sheet.getRange(linha, 1, 1, 2).setNumberFormat('@');
  sheet.getRange(linha, 1, 1, 2).setValues([[id, texto(nome)]]);
  return { id: id, nome: nome };
}

/* Limite mensal de gastos da categoria (0 ou vazio = sem limite). */
function definirOrcamento(id, limite) {
  garantirColunas(SHEET_CATEGORIAS, COLUNAS_CATEGORIAS);
  const sheet = aba(SHEET_CATEGORIAS);
  const linha = indiceDeIds(sheet)[String(id)];
  if (!linha) return { erro: 'Categoria não encontrada.', codigo: 404 };
  const v = Number(limite);
  if (limite !== '' && limite !== null && (!isFinite(v) || v < 0)) {
    return { erro: 'Limite inválido: ' + limite, codigo: 400 };
  }
  const celula = sheet.getRange(linha, 3);
  if (limite === '' || limite === null || v === 0) { celula.clearContent(); }
  else { celula.setNumberFormat('0.00').setValue(arred(v)); }
  return { ok: true };
}

/* Dia de fechamento e de vencimento da fatura do cartão (1-31, vazio = não
   usa). O app calcula em que mês cada compra cai e o lembrete usa o
   vencimento. */
function definirCartao(id, fechamento, vencimento) {
  garantirColunas(SHEET_CARTOES, COLUNAS_CARTOES);
  const sheet = aba(SHEET_CARTOES);
  const linha = indiceDeIds(sheet)[String(id)];
  if (!linha) return { erro: 'Cartão não encontrado.', codigo: 404 };
  const dia = function (v) {
    if (v === '' || v === null || v === undefined) return '';
    const n = parseInt(v, 10);
    return n >= 1 && n <= 31 ? String(n) : null;
  };
  const f = dia(fechamento), v = dia(vencimento);
  if (f === null || v === null) return { erro: 'Dia inválido (use 1 a 31).', codigo: 400 };
  sheet.getRange(linha, 3, 1, 2).setNumberFormat('@').setValues([[f, v]]);
  return { ok: true };
}

/* Ícone escolhido para a categoria (um emoji; vazio volta ao automático). */
function definirIcone(id, icone) {
  garantirColunas(SHEET_CATEGORIAS, COLUNAS_CATEGORIAS);
  const sheet = aba(SHEET_CATEGORIAS);
  const linha = indiceDeIds(sheet)[String(id)];
  if (!linha) return { erro: 'Categoria não encontrada.', codigo: 404 };
  const s = String(icone || '').trim().slice(0, 8);
  sheet.getRange(linha, 4).setNumberFormat('@').setValue(s);
  return { ok: true };
}

/* Acerto do mês: marca que a pessoa já te pagou a parte dela naquele mês
   (recebido = true) ou desfaz. Uma linha por mês+pessoa. Idempotente. */
function marcarAcerto(mes, pessoa, valor, recebido) {
  mes = formatarData(mes);
  if (!/^\d{4}-\d{2}-01$/.test(mes)) return { erro: 'Mês inválido: ' + mes, codigo: 400 };
  pessoa = String(pessoa || '').trim();
  if (!pessoa) return { erro: 'Pessoa não informada.', codigo: 400 };
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss.getSheetByName(SHEET_ACERTOS)) criarAba(ss, SHEET_ACERTOS, COLUNAS_ACERTOS);
  const sheet = aba(SHEET_ACERTOS);
  const dados = sheet.getDataRange().getValues();
  let linha = 0;
  for (let i = 1; i < dados.length; i++) {
    if (formatarData(dados[i][0]) === mes && String(dados[i][1]).trim() === pessoa) { linha = i + 1; break; }
  }
  if (!recebido) {
    if (linha) sheet.deleteRow(linha);
    return { ok: true };
  }
  const valores = [[mes, texto(pessoa), arred(valor), hojeISO()]];
  if (!linha) linha = sheet.getLastRow() + 1;
  sheet.getRange(linha, 1, 1, 4).setNumberFormat('@');
  sheet.getRange(linha, 3).setNumberFormat('0.00');
  sheet.getRange(linha, 1, 1, 4).setValues(valores);
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════
//  LEMBRETES POR E-MAIL
//  Rode `instalarLembretes` UMA vez pelo editor (o Google pede permissão
//  para enviar e-mail). Todo dia de manhã ele confere:
//  - fatura de cartão com vencimento em até 3 dias e algo pendente;
//  - no dia 1º, as contas sem cartão do mês que ainda estão pendentes.
//  O e-mail vai para a sua conta Google (dona do script). Cada aviso é
//  mandado uma vez só.
// ═══════════════════════════════════════════════════════════
function instalarLembretes() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'lembreteDiario') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('lembreteDiario').timeBased().everyDays(1).atHour(8).create();
  avisar('Lembretes instalados: todo dia ~8h, aviso de fatura perto do vencimento e, no dia 1º, as contas do mês.');
}

function removerLembretes() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'lembreteDiario') ScriptApp.deleteTrigger(t);
  });
  avisar('Lembretes desligados.');
}

function lembreteDiario() {
  const tz = Session.getScriptTimeZone();
  const agora = new Date();
  const hoje = new Date(Utilities.formatDate(agora, tz, 'yyyy-MM-dd') + 'T12:00:00');
  const props = PropertiesService.getScriptProperties();
  const lanc = lerAba(SHEET_LANCAMENTOS);
  const pendente = function (l) { return String(l.pago || '').toLowerCase() !== 'sim'; };
  const fmtR = function (v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ','); };
  const blocos = [];

  // faturas que vencem em até 3 dias
  lerAbaOpcional(SHEET_CARTOES).forEach(function (c) {
    const dv = parseInt(c.vencimento, 10);
    if (!(dv >= 1 && dv <= 31)) return;
    for (let mais = 0; mais <= 1; mais++) {
      const base = new Date(hoje.getFullYear(), hoje.getMonth() + mais, 1, 12);
      const ultimo = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
      const venc = new Date(base.getFullYear(), base.getMonth(), Math.min(dv, ultimo), 12);
      const dias = Math.round((venc - hoje) / 864e5);
      if (dias < 0 || dias > 3) continue;
      const chaveMes = Utilities.formatDate(venc, tz, 'yyyy-MM');
      const marca = 'LEMBRETE_' + c.id + '_' + chaveMes;
      if (props.getProperty(marca)) continue;
      const itens = lanc.filter(function (l) { return mesChaveDe(l.mes) === chaveMes && l.cartao === c.nome && pendente(l); });
      if (!itens.length) continue;
      const total = itens.reduce(function (s, l) { return s + Number(l.valor || 0); }, 0);
      blocos.push('💳 Fatura ' + c.nome + ' vence ' + (dias === 0 ? 'HOJE' : 'em ' + dias + ' dia(s)') +
        ' (dia ' + Utilities.formatDate(venc, tz, 'dd/MM') + '): ' + fmtR(total) + ' · ' + itens.length + ' lançamento(s)');
      props.setProperty(marca, '1');
    }
  });

  // dia 1º: contas sem cartão do mês
  if (hoje.getDate() === 1) {
    const chaveMes = Utilities.formatDate(hoje, tz, 'yyyy-MM');
    const marca = 'LEMBRETE_CONTAS_' + chaveMes;
    if (!props.getProperty(marca)) {
      const contas = lanc.filter(function (l) { return mesChaveDe(l.mes) === chaveMes && (!l.cartao || l.cartao === 'Sem cartão') && pendente(l); });
      if (contas.length) {
        const porConta = {};
        contas.forEach(function (l) {
          const nome = String(l.descricao).replace(/\s*\(Div\.\)\s*$/, '');
          porConta[nome] = (porConta[nome] || 0) + Number(l.valor || 0);
        });
        blocos.push('🏠 Contas do mês ainda pendentes:\n' + Object.keys(porConta).map(function (k) {
          return '   • ' + k + ': ' + fmtR(porConta[k]);
        }).join('\n'));
      }
      props.setProperty(marca, '1');
    }
  }

  if (!blocos.length) return 0;
  MailApp.sendEmail({
    to: Session.getEffectiveUser().getEmail(),
    subject: 'Controle Financeiro — contas a pagar',
    body: blocos.join('\n\n') + '\n\nAbra o app para marcar como pago.'
  });
  return blocos.length;
}

function removerLinha(nomeAba, id) {
  const sheet = aba(nomeAba);
  const linha = indiceDeIds(sheet)[String(id)];
  if (linha) sheet.deleteRow(linha);
  return { ok: true };
}

/* Só apaga com a senha do administrador conferida aqui. A senha errada
   conta no mesmo limite de tentativas do login: antes, esta ação servia
   para testar senhas sem limite nenhum.
   Observação: isto é uma confirmação contra acidente, não uma barreira —
   quem tem uma sessão aberta já consegue excluir lançamentos um a um. */
function limparDados(senha, travado) {
  const reserva = reservarTentativa(travado);
  if (reserva.erro) return reserva;
  if (!senhaConfere(senha)) {
    Utilities.sleep(700);
    const r = msgFalha(reserva.restam, 'Senha incorreta. Nada foi apagado.');
    if (r.codigo === 401) r.codigo = 403; // 401 faria o app achar que a sessão caiu
    return r;
  }
  tentativaOk();
  [SHEET_LANCAMENTOS, SHEET_RECEITAS].forEach(function (nome) {
    const sheet = aba(nome);
    const last = sheet.getLastRow();
    if (last > 1) sheet.deleteRows(2, last - 1);
  });
  // Zera o "último mês gerado" das cobranças fixas: sem isso elas ficariam
  // achando que já geraram tudo e nada voltaria depois da limpeza.
  const rec = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RECORRENTES);
  if (rec && rec.getLastRow() > 1) {
    rec.getRange(2, 10, rec.getLastRow() - 1, 1).setNumberFormat('@').clearContent();
  }
  return { ok: true };
}

// ═══════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════
function aba(nome) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome);
  if (!sheet) throw new Error('Aba "' + nome + '" não existe. Rode setupPlanilha.');
  return sheet;
}

function lerAba(nome) {
  const sheet = aba(nome);
  const dados = sheet.getDataRange().getValues();
  if (dados.length < 2) return [];
  const cabecalhos = dados[0];
  return dados.slice(1).map(function (linha) {
    const obj = {};
    cabecalhos.forEach(function (c, i) {
      let v = linha[i];
      if (v instanceof Date) v = formatarData(v);
      else if (typeof v === 'string' && /^'[=+\-@]/.test(v)) v = v.slice(1);
      obj[c] = v;
    });
    return obj;
  }).filter(function (o) {
    return Object.keys(o).some(function (k) { return o[k] !== '' && o[k] !== null; });
  });
}

/* Igual a lerAba, mas devolve [] se a aba ainda não existe — assim uma
   atualização do app não quebra antes de rodar setupPlanilha. */
function lerAbaOpcional(nome) {
  if (!SpreadsheetApp.getActiveSpreadsheet().getSheetByName(nome)) return [];
  return lerAba(nome);
}

/* {id: numeroDaLinha} numa leitura só. */
function indiceDeIds(sheet) {
  const ids = sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 1), 1).getValues();
  const mapa = {};
  for (let i = 1; i < ids.length; i++) {
    const v = String(ids[i][0]);
    if (v) mapa[v] = i + 1;
  }
  return mapa;
}

/* Texto que começa com = + - @ viraria fórmula na planilha. O apóstrofo
   força texto; lerAba o remove na volta. */
function texto(v) {
  const s = String(v == null ? '' : v).slice(0, 200);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function arred(v) { return Math.round((Number(v) || 0) * 100) / 100; }

function novoToken() { return Utilities.getUuid().replace(/-/g, ''); }

function hojeISO() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* "AAAA-MM-DD" vindo do app, se for uma data de verdade e não estiver no
   futuro (com 1 dia de folga para fusos diferentes); senão ''. */
function dataValida(v) {
  const s = String(v || '');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return '';
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  if (d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return '';
  if (d.getTime() > Date.now() + 864e5) return '';
  if (+m[1] < 2000) return '';
  return s;
}

/* A checagem das colunas novas roda no máximo uma vez por requisição. */
let _colunasLancOk = false;
function garantirColunasLancamentos() {
  if (_colunasLancOk) return;
  garantirColunas(SHEET_LANCAMENTOS, COLUNAS_LANCAMENTOS);
  _colunasLancOk = true;
}

function formatarData(d) {
  if (d === null || d === undefined) return '';
  if (typeof d === 'string') return d.substring(0, 10);
  if (d instanceof Date) {
    return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(d).substring(0, 10);
}

/* "AAAA-MM" de um valor da planilha ('' quando não dá para ler). Comparar
   essas chaves com < e > funciona porque o formato é fixo. */
function mesChaveDe(v) {
  const s = formatarData(v);
  return /^\d{4}-\d{2}/.test(s) ? s.substring(0, 7) : '';
}

function mesSeguinte(chave) {
  const partes = String(chave).split('-');
  const d = new Date(Date.UTC(parseInt(partes[0], 10), parseInt(partes[1], 10), 1));
  return d.getUTCFullYear() + '-' + ('0' + (d.getUTCMonth() + 1)).slice(-2);
}

function mesAtualChave() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM');
}
