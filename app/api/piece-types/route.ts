import { requireUser } from "../../../lib/auth";
import { listPieceTypes, PieceTypeError, savePieceType } from "../../../lib/piece-types";

export const dynamic = "force-dynamic";
const headers = { "cache-control": "no-store, no-cache, must-revalidate" };
function failure(error: unknown) {
  return Response.json({ error: error instanceof PieceTypeError ? error.message : "Não foi possível salvar ou carregar os tipos. Tente novamente." },
    { status: error instanceof PieceTypeError ? error.status : 500, headers });
}
export async function GET(request: Request) {
  try {
    const auth = await requireUser(request); if (auth instanceof Response) return auth;
    return Response.json({ pieceTypes: await listPieceTypes() }, { headers });
  } catch (error) { return failure(error); }
}
async function write(request: Request, editing: boolean) {
  try {
    const auth = await requireUser(request); if (auth instanceof Response) return auth;
    const body = await request.json();
    return Response.json({ pieceType: await savePieceType(body, editing) }, { status: editing ? 200 : 201, headers });
  } catch (error) { return failure(error); }
}
export async function POST(request: Request) { return write(request, false); }
export async function PATCH(request: Request) { return write(request, true); }
