# Gerar APK do Bankroll Poker

Este projeto Android fica na pasta `android` e abre o site local dentro de um WebView.

## Sem Android Studio

Use o GitHub Actions:

1. Suba esta pasta para um repositorio no GitHub.
2. Entre no repositorio pelo navegador.
3. Abra a aba `Actions`.
4. Clique em `Gerar APK`.
5. Clique em `Run workflow`.
6. Quando terminar, baixe o arquivo em `Artifacts` com o nome `Bankroll-Poker-APK`.

O APK gerado fica dentro do artifact como:

```text
app-debug.apk
```

## Com Android Studio

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Tambem funciona abrir a pasta `android` no Android Studio e usar:

```text
Build > Build Bundle(s) / APK(s) > Build APK(s)
```

## Observações

- O app funciona sem backend.
- Os dados continuam salvos no aparelho pelo `localStorage` do WebView.
- Para atualizar o app, altere os arquivos do site e copie novamente para `android/app/src/main/assets`.
