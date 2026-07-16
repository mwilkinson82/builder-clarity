import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ToolMode } from "./planRoomShared";

export function ScaleDraftEditor({
  tool,
  calibrationFeet,
  verifyFeet,
  onCalibrationFeetChange,
  onVerifyFeetChange,
}: {
  tool: ToolMode;
  calibrationFeet: string;
  verifyFeet: string;
  onCalibrationFeetChange: (value: string) => void;
  onVerifyFeetChange: (value: string) => void;
}) {
  if (tool !== "calibrate" && tool !== "verify") return null;
  const calibrating = tool === "calibrate";
  return (
    <div className="min-w-[210px]">
      <Label className="mb-1 block text-[10px]">
        {calibrating ? "Known real distance" : "Printed dimension"}
      </Label>
      <Input
        value={calibrating ? calibrationFeet : verifyFeet}
        onChange={(event) =>
          calibrating
            ? onCalibrationFeetChange(event.target.value)
            : onVerifyFeetChange(event.target.value)
        }
        placeholder={`Example: 12' 6"`}
        aria-label={
          calibrating
            ? "Known distance for scale calibration"
            : "Printed dimension for scale verification"
        }
        data-testid="scale-draft-distance-input"
      />
    </div>
  );
}
