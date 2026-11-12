#!/bin/sh
# Atualiza a versão do cache do app (CACHE_VERSION no sw.js) a partir do
# conteúdo dos arquivos. Rodar antes de publicar: assim o celular sempre
# percebe que há versão nova e mostra o aviso "Atualizar".
cd "$(dirname "$0")/.." || exit 1
v=$(cat index.html manifest.json icons/*.png | sha1sum | cut -c1-10)
sed -i "s/^const CACHE_VERSION = '.*';/const CACHE_VERSION = '$v';/" sw.js
echo "versão $v"
