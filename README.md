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
