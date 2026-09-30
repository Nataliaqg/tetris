---
description: Crea un git worktree en .tree/[nombre] y ejecuta ahí las instrucciones recibidas
argument-hint: [instrucciones a ejecutar en el worktree]
---

Requerimiento del usuario: $ARGUMENTS

Sigue estos pasos en orden:

1. Determina un `[nombre]` corto en kebab-case (minúsculas, sin espacios ni acentos, máx. 4 palabras) que describa el requerimiento de arriba. Ejemplo: "agregar pantalla de puntajes" -> `pantalla-puntajes`.
2. Crea el worktree desde la raíz del repositorio con:
   `git worktree add .tree/[nombre]`
   Si el directorio o la rama ya existen, elige otro nombre; no borres nada existente.
3. Si `.tree/` no está en `.gitignore`, agrégalo.
4. Ejecuta TODAS las instrucciones del requerimiento dentro de `.tree/[nombre]` (lee, edita y corre comandos con esa ruta). No modifiques los archivos del directorio principal.
5. Al terminar, informa el nombre elegido, la ruta del worktree, la rama creada y un resumen de los cambios. No hagas commit, push ni elimines el worktree salvo que el usuario lo pida.

Si `$ARGUMENTS` está vacío, pide al usuario las instrucciones antes de crear el worktree.
