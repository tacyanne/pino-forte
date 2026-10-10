import { requireUser } from "../../../lib/auth";
import { listPieceLines, PieceLineError, savePieceLine } from "../../../lib/piece-lines";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store, no-cache, must-revalidate" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof PieceLineError ? error.message : "Não foi possível salvar ou carregar as linhas. Tente novamente." },
    { status: error instanceof PieceLineError ? error.status : 500, headers });
}
export async function GET(request: Request) {
  try {
    const auth = await requireUser(request); if (auth instanceof Response) return auth;
    return Response.json({ pieceLines: await listPieceLines() }, { headers });
  } catch (error) { return failure(error); }
}
async function write(request: Request, editing: boolean) {
  try {
    const auth = await requireUser(request); if (auth instanceof Response) return auth;
    const body = await request.json();
    return Response.json({ pieceLine: await savePieceLine(body, editing) }, { status: editing ? 200 : 201, headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) { return write(request, false); }
export async function PATCH(request: Request) { return write(request, true); }
