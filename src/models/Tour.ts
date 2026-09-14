import mongoose, { Schema, Document, Types } from 'mongoose';

export interface ITour extends Document {
  _id: Types.ObjectId;
  id_tour: string;
  id_cycle: Types.ObjectId;
  id_membre_groupe: Types.ObjectId;
  ordre_passage: number;
  date_prevue: Date;
  statut: 'en_attente' | 'distribue' | 'saute';
}

const TourSchema = new Schema<ITour>(
  {
    id_cycle: { type: Schema.Types.ObjectId, ref: 'Cycle', required: true, index: true },
    id_membre_groupe: { type: Schema.Types.ObjectId, ref: 'GroupMember', required: true, index: true },
    ordre_passage: { type: Number, required: true },
    date_prevue: { type: Date, required: true },
    statut: {
      type: String,
      enum: ['en_attente', 'distribue', 'saute'],
      default: 'en_attente'
    }
  },
  {
    toJSON: {
      virtuals: true,
      transform: (_doc, ret: any) => {
        ret.id_tour = ret._id.toString();
        delete ret.__v;
        return ret;
      }
    }
  }
);

TourSchema.virtual('id_tour').get(function (this: ITour) {
  return this._id.toString();
});

export const Tour = mongoose.model<ITour>('Tour', TourSchema);
