# Exclusao administrativa de ordens

`DELETE /api/orders` exige sessao ativa, papel exatamente `admin` e o header
`x-confirm-delete-orders: delete-all`. A verificacao ocorre antes de selecionar
o adaptador REST ou Postgres. Usuarios comuns recebem 403; requisicoes sem sessao
valida recebem 401; administradores sem confirmacao recebem 400.

O endpoint continua sendo uma operacao de manutencao que tenta excluir todas as
OS. Nao existe chamada para essa operacao na interface atual. A confirmacao deve
ser enviada conscientemente por qualquer ferramenta administrativa que a utilize.
O header nao substitui autorizacao. Nao habilitar CORS para origens nao confiaveis.

As chaves estrangeiras existentes continuam protegendo OS vinculadas a contas,
recebimentos e itens. Um conflito 23503 retorna 409 sem expor detalhes do banco.
Nao ha exclusao em cascata, remocao de vinculos ou tentativa por registro.

## Verificacao isolada

`node --test tests/orders-delete.test.mjs` executa a rota e a autenticacao reais,
com I/O de banco simulado e credenciais ficticias. Cobre os dois adaptadores,
anonimo, sessao expirada, usuario inativo/comum, papel desconhecido, confirmacao
administrativa, conflito de chave estrangeira e erro interno. Valida que nenhum
DELETE chega aos adaptadores quando a autorizacao ou confirmacao falha.

O teste de conflito simula a resposta do banco; nao comprova o schema instalado
em producao. Os testes nao executam exclusoes reais.

## Revisao e publicacao posterior

1. Revisar o diff, testes e compatibilidade de ferramentas administrativas com o
   novo header. A migracao Next.js/Vercel e o seletor de pecas nao sao alterados.
2. Em ambiente descartavel com dados ficticios, confirmar que as chaves
   estrangeiras RESTRICT da migracao foundation estao presentes e impedem excluir
   OS vinculadas. Nenhuma migracao e necessaria para esta correcao.
3. Somente apos aprovacao da usuaria, seguir o processo de merge e publicacao,
   registrando o commit implantado. Nao testar este DELETE contra dados reais.

## Recebimentos

O complemento financeiro esta descrito em [receipts-integrity.md](receipts-integrity.md).
Ele requer a migracao de recebimentos antes da publicacao do aplicativo. A
exclusao administrativa, isoladamente, nao exige migracao. A validacao de locks
com multiplas conexoes e a integracao PostgREST permanecem pendentes.
