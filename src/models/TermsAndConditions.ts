import pool from '../config/database';

export interface TermsAndConditions {
  id: number;
  title: string;
  content: string;
  version: number;
  is_active: boolean;
  created_by: number;
  created_at: Date;
  updated_at: Date;
}

export class TermsAndConditionsModel {
  static async findActive(): Promise<TermsAndConditions | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM terms_and_conditions WHERE is_active = true ORDER BY version DESC, updated_at DESC LIMIT 1'
    ) as any[];
    
    if (rows.length === 0) {
      return null;
    }
    
    return this.mapRowToTerms(rows[0]);
  }

  static async findAll(): Promise<TermsAndConditions[]> {
    const [rows] = await pool.execute(
      'SELECT * FROM terms_and_conditions ORDER BY version DESC, updated_at DESC'
    ) as any[];
    
    return rows.map(row => this.mapRowToTerms(row));
  }

  static async findById(id: number): Promise<TermsAndConditions | null> {
    const [rows] = await pool.execute(
      'SELECT * FROM terms_and_conditions WHERE id = ?',
      [id]
    ) as any[];
    
    if (rows.length === 0) {
      return null;
    }
    
    return this.mapRowToTerms(rows[0]);
  }

  static async create(
    title: string,
    content: string,
    createdBy: number
  ): Promise<TermsAndConditions> {
    // Desactivar todos los términos anteriores
    await pool.execute(
      'UPDATE terms_and_conditions SET is_active = false WHERE is_active = true'
    );

    // Obtener la última versión
    const [versionRows] = await pool.execute(
      'SELECT MAX(version) as max_version FROM terms_and_conditions'
    ) as any[];
    
    const newVersion = (versionRows[0]?.max_version || 0) + 1;

    // Insertar nuevos términos
    const [result] = await pool.execute(
      `INSERT INTO terms_and_conditions (title, content, version, is_active, created_by)
       VALUES (?, ?, ?, true, ?)`,
      [title, content, newVersion, createdBy]
    ) as any[];

    const terms = await this.findById(result.insertId);
    if (!terms) {
      throw new Error('Error al crear términos y condiciones');
    }

    return terms;
  }

  static async update(
    id: number,
    title: string,
    content: string
  ): Promise<TermsAndConditions> {
    await pool.execute(
      'UPDATE terms_and_conditions SET title = ?, content = ?, updated_at = NOW() WHERE id = ?',
      [title, content, id]
    );

    const terms = await this.findById(id);
    if (!terms) {
      throw new Error('Error al actualizar términos y condiciones');
    }

    return terms;
  }

  static async setActive(id: number): Promise<void> {
    // Desactivar todos los términos
    await pool.execute(
      'UPDATE terms_and_conditions SET is_active = false'
    );

    // Activar el seleccionado
    await pool.execute(
      'UPDATE terms_and_conditions SET is_active = true WHERE id = ?',
      [id]
    );
  }

  static async delete(id: number): Promise<void> {
    await pool.execute(
      'DELETE FROM terms_and_conditions WHERE id = ?',
      [id]
    );
  }

  private static mapRowToTerms(row: any): TermsAndConditions {
    return {
      id: row.id,
      title: row.title,
      content: row.content,
      version: row.version,
      is_active: row.is_active === 1 || row.is_active === true,
      created_by: row.created_by,
      created_at: new Date(row.created_at),
      updated_at: new Date(row.updated_at),
    };
  }
}
