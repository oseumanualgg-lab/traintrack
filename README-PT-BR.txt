TRAINTRACK — GUIA RÁPIDO
=======================

O que é
-------
TRAINTRACK é um aplicativo web instalável (PWA), com aparência de app Android.
Ele foi preparado para funcionar sem conta e sem servidor de banco de dados:
seus registros e fotos ficam armazenados localmente no navegador do aparelho.

Como colocar no celular gratuitamente
-------------------------------------
O app precisa ser publicado em um endereço HTTPS para que o Chrome permita
instalação e funcionamento offline. Uma opção gratuita é o GitHub Pages.

1. No computador, crie uma conta gratuita em https://github.com/ (ou use uma
   conta que já tenha).
2. Crie um repositório novo chamado traintrack. Pode deixá-lo público.
3. Envie TODOS os arquivos e pastas desta pasta para a raiz do repositório.
   Não envie apenas o ZIP: extraia primeiro e envie index.html, app.js,
   styles.css, manifest.webmanifest, sw.js e a pasta icons.
4. No GitHub, abra Settings > Pages.
5. Em Build and deployment, escolha Deploy from a branch.
6. Selecione a branch main e a pasta /(root), depois clique Save.
7. Aguarde o GitHub mostrar o endereço publicado (algo como
   https://SEU-USUARIO.github.io/traintrack/).
8. Abra esse endereço no Chrome do Android.
9. Use o menu ⋮ do Chrome e escolha Instalar app ou Adicionar à tela inicial.

Importante: este projeto é uma PWA, não um APK nativo. Ele pode ser adicionado
à tela inicial e abrir em uma janela própria, mas não é distribuído pela Play
Store nem gera um arquivo .apk por si só.

Recursos incluídos
------------------
- Registro de um treino por dia, com possibilidade de corrigir datas passadas.
- Calendário mensal, com dias treinados e dias planejados destacados.
- Sequência atual e recorde, em modo de dias corridos ou dias planejados.
- Configuração dos dias de treino da semana.
- Fotos de início e fim de cada mês, guardadas no aparelho.
- Gráficos e relatórios de treino por mês e ano.
- Exportação e importação de backup JSON.
- Exportação de lembrete recorrente em arquivo .ics para importar no calendário.
- Interface em preto, branco e amarelo.

Limites importantes
------------------
- Os dados e as fotos ficam no armazenamento do navegador deste aparelho.
  Exporte backups regularmente. Limpar os dados do Chrome pode apagar o histórico.
- As notificações do próprio app dependem de o app estar aberto. Páginas web não
  conseguem garantir um alarme local confiável quando estão totalmente fechadas
  sem um serviço de notificações ou integração nativa. Para isso, use o botão
  “Baixar lembrete para o calendário (.ics)” e importe o arquivo no calendário
  Android/Google Calendar, verificando se o calendário está configurado para
  enviar alertas.
- Este projeto não sincroniza dados entre aparelhos e não envia fotos à nuvem.

Privacidade
-----------
Não há analytics, login, servidor remoto ou envio automático de fotos. Os
registros são gravados no IndexedDB local do navegador.
