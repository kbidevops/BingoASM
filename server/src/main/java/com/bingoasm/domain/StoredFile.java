package com.bingoasm.domain;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "files")
public class StoredFile {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    public Long fileId;
    public String storedName;
    public String originalName;
    public String mimeType;
    public Long fileSize;
    public LocalDateTime createdAt;
}
