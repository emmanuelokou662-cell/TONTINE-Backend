import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IOtpCode extends Document {
  _id: Types.ObjectId;
  id: string;
  email: string;
  code: string;
  tentatives: number;
  expire_a: Date;
  utilise: boolean;
  created_at: Date;
}

const OtpCodeSchema = new Schema<IOtpCode>(
  {
    email: { type: String, required: true, lowercase: true, trim: true, index: true },
    code: { type: String, required: true },
    tentatives: { type: Number, default: 0 },
    expire_a: { type: Date, required: true },
    utilise: { type: Boolean, default: false }
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: false },
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id = ret._id.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

OtpCodeSchema.virtual('id').get(function (this: IOtpCode) {
  return this._id.toString();
});

export const OtpCode = mongoose.model<IOtpCode>('OtpCode', OtpCodeSchema);
