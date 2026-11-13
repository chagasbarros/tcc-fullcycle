# Contribuidores

Trabalho de Conclusão de Curso **individual** (Fullcycle, Geração Tech).

## Autor

| Nome              | Papel                                                                                                                                                                                                       | Contato                                                    |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| **Chagas Barros** | Autor e único responsável pelo projeto: requisitos, decisões de arquitetura (ADRs), revisão e merge de todo o código, operação dos ambientes (Render, GitHub, segredos) e aprovação dos deploys em produção | [github.com/chagasbarros](https://github.com/chagasbarros) |

## Assistência de IA

| Ferramenta                  | Papel                                                                                                                                                                                                                                                                              |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Claude Code** (Anthropic) | Assistente de programação. Sugeriu alternativas com trade-offs, escreveu código, testes e documentação, rodou as verificações (lint, typecheck, testes, k6) e levantou hipóteses de gargalo. **Não tomou decisões:** cada escolha relevante foi apresentada ao autor, que decidiu. |

Seguindo a regra do curso ("a IA sugere, a decisão é do autor"):

- as regras que a IA seguiu estão em [`CLAUDE.md`](CLAUDE.md);
- os prompts que mudaram o rumo do projeto, com a sugestão da IA e a decisão do autor, estão em [`docs/ia.md`](docs/ia.md);
- os commits feitos com a assistência da IA trazem a linha `Co-Authored-By: Claude`.

## Referências

- Ebook de System Design, módulo 4 (curso Fullcycle): base dos ADR-0003, 0004, 0021 e 0022
