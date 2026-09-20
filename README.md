# GEOFOTO KMZ

Aplicativo de campo para captura de fotos georreferenciadas com GPS, mapa e exportação KML/KMZ.

## Arquitetura
- Cloudflare Worker: aplicação e API
- Cloudflare D1: registros e metadados
- Cloudflare R2: armazenamento das fotos
- Vite: interface web

## Segurança
As senhas e tokens de produção não ficam neste repositório. Eles são armazenados como Cloudflare Secrets.

## Desenvolvimento
```bash
npm install
npm run dev
```

## Publicação
```bash
npm run build
npx wrangler deploy
```

Endereço de produção:
https://geofoto-kmz.geofotokmz.workers.dev

## Atualizações do aplicativo
A partir da versão 1.1.0, o GeoFoto KMZ possui atualização assistida de PWA:
- o aplicativo verifica novas versões ao abrir e periodicamente;
- quando uma versão nova estiver pronta, exibe **Atualizar agora**;
- a atualização não apaga registros, fotos, D1 ou R2;
- a versão instalada aparece em **Configurações > Aplicativo**;
- também existe o botão **Verificar atualização**.

Em cada nova publicação devem ser atualizados em conjunto o `APP_VERSION`, `public/version.json` e a versão do cache em `public/sw.js`.

## Padrão oficial de versões
O GeoFoto KMZ usa o formato **MAJOR.MINOR.PATCH**:

- **MAJOR**: mudança grande de arquitetura, fluxo ou compatibilidade. Ex.: 1.x.x -> 2.0.0.
- **MINOR**: nova função ou melhoria importante. Ex.: 1.2.x -> 1.3.0.
- **PATCH**: correção de erro, ajuste visual ou melhoria pequena. Ex.: 1.2.5 -> 1.2.6.

Versão oficial atual: **1.2.5**.

Sempre que houver nova publicação, devem avançar juntos:
1. `APP_VERSION` em `src/main4.js`;
2. `version` em `public/version.json`;
3. a chave `CACHE` em `public/sw.js`.

Isso garante que os aparelhos detectem a atualização corretamente sem reinstalação.
