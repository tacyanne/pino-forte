# Recebimentos atomicos e repeticoes

O PATCH de accountsReceivable usa `receive_payments` nos dois adaptadores:
uma chamada RPC POST no REST ou uma chamada SQL parametrizada no Postgres.
Carteira envia todas as parcelas em um lote unico; boleto usa o mesmo caminho.
Nao existe fallback para gravacoes separadas se a funcao estiver ausente.

A funcao grava recibos, contas, OS, caixa, auditoria e resposta idempotente na
mesma transacao. Falhas desfazem inclusive a reserva da chave. Uma repeticao
retorna a resposta original, mesmo depois de pagamentos posteriores. Reutilizar
a chave com outros dados retorna 409. O residuo de ate R$1 continua sendo abatido
do total, sem criar caixa ficticio.

## Contrato e concorrencia

- Header `Idempotency-Key`: UUID mantido durante a mesma tentativa.
- Body: `entity: accountsReceivable`, `payments` com 1 a 100 objetos contendo
  `id`, `amountCents`, `expectedBalanceCents`, `paymentMethod`, `receiptDate`
  (YYYY-MM-DD) e `notes`. Uma conta aparece no maximo uma vez.
- O formato de conta unica tambem e aceito, com os mesmos campos obrigatorios.
  Clientes antigos precisam ser atualizados; valores em reais (`amount`) nao
  substituem centavos inteiros neste endpoint.
- A identidade vem da sessao validada, nunca de um campo do body. Qualquer usuario
  ativo pode receber, como antes. A exclusao ampla continua exclusiva de admin.
- A chave e unica por usuario. Uma PK serializa repeticoes da mesma chave.
  Bloqueios `FOR UPDATE` de OS e contas, sempre em ordem, protegem lotes sobrepostos.
  O saldo esperado rejeita uma segunda tentativa obsoleta, mesmo com outra chave.
- Uma falha de transporte retorna 503 sem revelar detalhes. Repetir os mesmos
  dados com a mesma chave e seguro. O cliente conserva essa tentativa em
  sessionStorage; se nao conseguir salva-la, falha antes de enviar.
- A sincronizacao Postgres importa somente contas ausentes. Nao regrava contas
  existentes nem cria um segundo recibo inicial a partir de recebimentos acumulados.

`receipt_requests` tem RLS e nenhum acesso para anon/authenticated. A funcao e
SECURITY INVOKER, search_path vazio, com EXECUTE revogado de PUBLIC/anon/authenticated
e concedido a service_role. O usuario SQL direto precisa dos privilegios existentes
nas tabelas e dos privilegios de acesso a essa funcao/tabela; revisar essa identidade
na implantacao, sem conceder acesso publico para contornar erros.

## Evidencia e limites

`tests/receipts-sql.test.mjs` executa a migracao e a funcao reais em PGlite,
PostgreSQL WebAssembly em memoria. Verifica pagamentos parciais, quitacao, residuo,
lote, replay, saldo obsoleto, cancelamento, permissao, rollback no caixa/auditoria
e falha na segunda conta. Tambem executa a sincronizacao Drizzle apos receber.
Nenhum servico, banco externo, credencial ou dado real e usado.

`tests/receipts-api.test.mjs` executa a rota/autenticacao com transportes simulados,
verifica parametros dos dois adaptadores, validacao, falhas sem fallback e a chave
persistida pelo cliente. Os testes anteriores de strings foram atualizados onde
a logica saiu da rota; o comportamento financeiro agora e exercitado no SQL.

PGlite serializa comandos em uma conexao. Promise.all no teste prova replay de
chamadas enfileiradas, NAO comprova disputa de locks entre conexoes. Ainda e
necessario validar em PostgreSQL descartavel com duas conexoes e PostgREST real:

1. Mesmo usuario/chave: segurar a primeira transacao, iniciar a segunda, confirmar
   espera e apenas um recibo/caixa ao liberar a primeira.
2. Chaves diferentes e mesmo saldo esperado: uma confirma, outra retorna 409.
3. Lotes sobrepostos em ordens diferentes: confirmar ausencia de deadlock e
   consistencia dos saldos; repetir apos timeout/rollback com a mesma chave.
4. RPC ausente, permissao negada, sessao invalida e resposta perdida: nenhuma
   gravacao parcial; replay deve recuperar o resultado confirmado.

O escopo e o recebimento via financeiro. Criacao/edicao monetaria de OS e contas
a pagar ainda possuem outros caminhos; isto nao afirma atomicidade global desses
fluxos. Edicoes monetarias concorrentes de OS devem ser cobertas pela validacao
integrada antes de liberacao; a funcao rejeita inconsistencias ja presentes entre
o valor recebido/total da OS e a conta, sem tentar corrigi-las silenciosamente.

## Sequencia de implantacao (exige aprovacao posterior)

1. Revisar a migracao `20261014163624_atomic_receipts.sql`, gerada pela CLI e
   preenchida com o SQL testado. Nao foi aplicada a banco real.
2. Em banco descartavel, aplicar foundation e migracoes relevantes, conferir
   privilegios/RLS com advisors e executar os testes multiconexao/PostgREST acima.
3. Conferir historico das migracoes existentes (inclui nomes legados repetidos);
   nao executar indiscriminadamente todos os scripts de reset/importacao.
4. Apos aprovacao, preparar backup e aplicar a nova migracao antes do aplicativo;
   a mudanca e aditiva. Pausar recebimentos durante a transicao e aguardar as
   requisicoes antigas terminarem para nao misturar escritores antigos e novos.
   Conferir cache RPC e publicar o commit revisado.
5. Conferir recebimento com dados ficticios em homologacao. Sem a migracao, o novo
   aplicativo retorna 503 e nao usa o caminho antigo. Nao apagar receipt_requests
   ao reverter o aplicativo: isso eliminaria o historico de idempotencia.

Referencias de arquitetura: [funcoes Supabase](https://supabase.com/docs/guides/database/functions)
e [transacoes PostgREST](https://docs.postgrest.org/en/stable/references/transactions.html).
