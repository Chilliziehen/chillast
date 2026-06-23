// cli.mjs — tiny shared arg parser for the knowledge tools.
//   --corpus <id> | --corpus=<id>   knowledge subject (default: astrology)
//   --force                          ignore caches / rebuild
//   --apply                          write changes (denoise dry-run → apply)
//   <positional>                     filename filter substring

export function parseArgs(argv) {
  let corpusId = 'astrology';
  let name = null;
  let force = false;
  let apply = false;
  let filter = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--corpus') corpusId = argv[++i] || corpusId;
    else if (a.startsWith('--corpus=')) corpusId = a.slice('--corpus='.length);
    else if (a === '--name') name = argv[++i] || name;
    else if (a.startsWith('--name=')) name = a.slice('--name='.length);
    else if (a === '--force') force = true;
    else if (a === '--apply') apply = true;
    else if (!a.startsWith('--')) filter = a;
  }
  return { corpusId, name, force, apply, filter };
}
